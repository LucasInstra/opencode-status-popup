# Shared helpers for the opencode status popup host.
#
# The host process is spawned by the plugin. It reads the presence files that
# every plugin instance keeps fresh in <state dir>\state\*.json and renders them
# as an always-on-top window or a system tray icon.
#
# Keep this file ASCII only: Windows PowerShell reads .ps1 files as ANSI unless
# they carry a BOM, so non ASCII characters would be mangled.

function Initialize-PopupNative {
  if ("PopupWin32" -as [type]) { return }

  Add-Type -Namespace PopupWin32 -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetWindowLong(System.IntPtr hWnd, int nIndex);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int SetWindowLong(System.IntPtr hWnd, int nIndex, int dwNewLong);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool DestroyIcon(System.IntPtr hIcon);
"@
}

function Initialize-PopupHost {
  param(
    [string]$StateDir,
    [string]$LogPath
  )

  if ([string]::IsNullOrWhiteSpace($StateDir)) {
    $StateDir = Join-Path $env:TEMP "opencode-status-popup"
  }
  if (-not [System.IO.Directory]::Exists($StateDir)) {
    [void][System.IO.Directory]::CreateDirectory($StateDir)
  }

  $script:StateDirPath = [System.IO.Path]::GetFullPath($StateDir)
  $script:PresenceDir = Join-Path $script:StateDirPath "state"
  if (-not [System.IO.Directory]::Exists($script:PresenceDir)) {
    [void][System.IO.Directory]::CreateDirectory($script:PresenceDir)
  }

  if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $script:LogPath = Join-Path $script:StateDirPath "host.log"
  } else {
    $script:LogPath = $LogPath
  }

  $script:HostInfoPath = Join-Path $script:StateDirPath "host.json"
  $script:WindowStatePath = Join-Path $script:StateDirPath "window.json"

  Initialize-PopupNative
}

function Write-PopupLog {
  param([string]$Message)

  try {
    if ([System.IO.File]::Exists($script:LogPath)) {
      $info = New-Object System.IO.FileInfo($script:LogPath)
      if ($info.Length -gt 262144) { [System.IO.File]::Delete($script:LogPath) }
    }
  } catch { }

  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $Message
  try {
    [System.IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
  } catch { }
}

function Write-JsonFile {
  # Writes JSON without a BOM so Node's JSON.parse can read it back.
  param(
    [string]$Path,
    [string]$Json
  )

  $tmp = "$Path.tmp"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $Json, $encoding)
  if ([System.IO.File]::Exists($Path)) { [System.IO.File]::Delete($Path) }
  [System.IO.File]::Move($tmp, $Path)
}

function ConvertTo-JsonCompact {
  param($Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Get-Timestamp {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Write-HostHeartbeat {
  param([hashtable]$Fields)

  $payload = [ordered]@{
    version = 1
    pid     = $PID
    updated = Get-Timestamp
  }
  foreach ($key in $Fields.Keys) { $payload[$key] = $Fields[$key] }

  try {
    Write-JsonFile -Path $script:HostInfoPath -Json (ConvertTo-JsonCompact $payload)
  } catch { }
}

function Get-AggregateState {
  param([int]$FreshSeconds = 20)

  $now = Get-Timestamp
  $busy = 0
  $retry = 0
  $writers = 0
  $projects = New-Object System.Collections.Generic.List[string]

  $files = @()
  try {
    $files = [System.IO.Directory]::GetFiles($script:PresenceDir, "*.json")
  } catch { }

  foreach ($file in $files) {
    $raw = $null
    try {
      $raw = [System.IO.File]::ReadAllText($file)
    } catch {
      continue
    }
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }

    $entry = $null
    try {
      $entry = $raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
      continue
    }
    if ($null -eq $entry -or $null -eq $entry.updated) { continue }

    $updated = [double]$entry.updated
    if (($now - $updated) -gt ($FreshSeconds * 1000)) { continue }

    $writers++
    $busy += [int]$entry.busy
    $retry += [int]$entry.retry
    if ($entry.project) {
      $name = [string]$entry.project
      if (-not $projects.Contains($name)) { $projects.Add($name) }
    }
  }

  $phase = "idle"
  if ($busy -gt 0) {
    if ($retry -gt 0) { $phase = "retry" } else { $phase = "busy" }
  }

  return [pscustomobject]@{
    Online   = ($writers -gt 0)
    Writers  = $writers
    Busy     = $busy
    Retry    = $retry
    Phase    = $phase
    Projects = @($projects)
  }
}

function Get-AggregateSignature {
  param($Aggregate)

  $projects = @($Aggregate.Projects) -join ","
  return "{0}|{1}|{2}|{3}" -f $Aggregate.Phase, $Aggregate.Busy, $Aggregate.Writers, $projects
}

function Format-AggregateTooltip {
  param(
    $Aggregate,
    [string]$Word,
    [string]$ProgressWord
  )

  $where = ""
  if ($Aggregate.Projects.Count -gt 0) {
    $where = " - " + ($Aggregate.Projects -join ", ")
  }

  switch ($Aggregate.Phase) {
    "busy" { $state = "digitando " + $ProgressWord }
    "retry" { $state = "tentando de novo..." }
    default { $state = $Word + " (ocioso)" }
  }

  $text = "opencode$where - $state"
  if ($text.Length -gt 63) { $text = $text.Substring(0, 60) + "..." }
  return $text
}

function Read-WindowState {
  try {
    if ([System.IO.File]::Exists($script:WindowStatePath)) {
      $raw = [System.IO.File]::ReadAllText($script:WindowStatePath)
      if (-not [string]::IsNullOrWhiteSpace($raw)) { return ($raw | ConvertFrom-Json) }
    }
  } catch { }
  return $null
}

function Save-WindowState {
  param(
    [double]$Left,
    [double]$Top
  )

  $payload = [ordered]@{
    left    = [Math]::Round($Left, 1)
    top     = [Math]::Round($Top, 1)
    updated = Get-Timestamp
  }
  try {
    Write-JsonFile -Path $script:WindowStatePath -Json (ConvertTo-JsonCompact $payload)
  } catch { }
}
