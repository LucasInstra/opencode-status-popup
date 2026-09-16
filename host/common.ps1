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
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hWnd);
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

# Walks the parent chain of a process looking for a window: the terminal that
# hosts the TUI (Windows Terminal, VS Code, WezTerm, the desktop app) shows up
# as a windowed ancestor of the OpenCode process.
function Get-AncestorWindowHandle {
  param([int]$ProcessId)

  $current = $ProcessId
  for ($depth = 0; $depth -lt 8 -and $current -gt 0; $depth++) {
    $process = Get-Process -Id $current -ErrorAction SilentlyContinue
    if ($null -eq $process) { return [IntPtr]::Zero }
    if ($process.MainWindowHandle -ne 0) { return $process.MainWindowHandle }

    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
    if ($null -eq $parent) { return [IntPtr]::Zero }
    $next = [int]$parent.ParentProcessId
    if ($next -le 0 -or $next -eq $current) { return [IntPtr]::Zero }
    $current = $next
  }

  return [IntPtr]::Zero
}

# The TUI starts the service and the service outlives its parent, so the chain
# of the process that wrote the presence file is often dead. Other processes of
# the same executable still have the terminal in their chain.
function Get-TerminalWindowHandle {
  param([int]$ProcessId)

  if ($ProcessId -le 0) { return [IntPtr]::Zero }

  $direct = Get-AncestorWindowHandle -ProcessId $ProcessId
  if ($direct -ne [IntPtr]::Zero) { return $direct }

  $self = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $self) { return [IntPtr]::Zero }

  $siblings = @(Get-Process -Name $self.ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $ProcessId })
  foreach ($sibling in $siblings) {
    $handle = Get-AncestorWindowHandle -ProcessId $sibling.Id
    if ($handle -ne [IntPtr]::Zero) { return $handle }
  }

  return [IntPtr]::Zero
}

# Brings the OpenCode terminal forward for a click on the popup: restore it when
# minimized and hand it the foreground. Returns false when no window was found,
# so callers can fall back to the details balloon.
function Focus-OpenCodeWindow {
  param([int]$ProcessId)

  $handle = Get-TerminalWindowHandle -ProcessId $ProcessId
  if ($handle -eq [IntPtr]::Zero) { return $false }

  try {
    if ([PopupWin32.Native]::IsIconic($handle)) {
      [void][PopupWin32.Native]::ShowWindowAsync($handle, 9)
    }
    [void][PopupWin32.Native]::SetForegroundWindow($handle)
    return $true
  } catch {
    return $false
  }
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
  $entries = New-Object System.Collections.Generic.List[object]

  $files = @()
  try {
    $files = [System.IO.Directory]::GetFiles($script:PresenceDir, "*.json")
  } catch { }

  foreach ($file in $files) {
    $raw = $null
    try {
      # Share delete on purpose: the plugin replaces the file atomically and a
      # read handle that denied it would make the writer fail with a sharing
      # violation on Windows.
      $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
      $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
      try {
        $reader = New-Object System.IO.StreamReader($stream)
        $raw = $reader.ReadToEnd()
      } finally {
        $reader.Dispose()
      }
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
    if (($now - [double]$entry.updated) -gt ($FreshSeconds * 1000)) { continue }

    $entries.Add($entry)
  }

  $busy = 0
  $retry = 0
  $errors = 0
  $permissions = 0
  $projects = New-Object System.Collections.Generic.List[string]

  foreach ($entry in $entries) {
    $busy += [int]$entry.busy
    $retry += [int]$entry.retry
    $errors += [int]$entry.errors
    $permissions += [int]$entry.permissions
    if ($entry.project) {
      $name = [string]$entry.project
      if (-not $projects.Contains($name)) { $projects.Add($name) }
    }
  }

  # Lowest priority first, so the highest one wins.
  $phase = "idle"
  if ($busy -gt 0) { $phase = "busy" }
  if ($retry -gt 0) { $phase = "retry" }
  if ($errors -gt 0) { $phase = "error" }
  if ($permissions -gt 0) { $phase = "permission" }

  $detail = ""
  # The pid of a live writer: the tray uses it to bring the terminal forward.
  $writerPid = 0
  foreach ($entry in $entries) {
    if ($writerPid -eq 0 -and $entry.pid) { $writerPid = [int]$entry.pid }
    if ($entry.phase -eq $phase -and $entry.detail) {
      $detail = [string]$entry.detail
      if ($entry.pid) { $writerPid = [int]$entry.pid }
      break
    }
  }

  return [pscustomobject]@{
    Online      = ($entries.Count -gt 0)
    Writers     = $entries.Count
    Pid         = $writerPid
    Busy        = $busy
    Retry       = $retry
    Errors      = $errors
    Permissions = $permissions
    Phase       = $phase
    Detail      = $detail
    Projects    = @($projects)
  }
}

function Get-AggregateSignature {
  param($Aggregate)

  $projects = @($Aggregate.Projects) -join ","
  return "{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}" -f $Aggregate.Phase, $Aggregate.Pid, $Aggregate.Busy, $Aggregate.Retry, $Aggregate.Errors, $Aggregate.Permissions, $Aggregate.Detail, $projects
}

function Format-AggregateTooltip {
  param(
    $Aggregate,
    [string]$Word,
    [string]$ProgressWord
  )

  $where = $Word
  if ($Aggregate.Projects.Count -gt 0) {
    $where = ($Aggregate.Projects -join ", ")
  }

  $detail = [string]$Aggregate.Detail
  switch ($Aggregate.Phase) {
    "permission" {
      $state = "needs you"
      if ($detail) { $state = "needs you: " + $detail }
    }
    "error" {
      $state = "error"
      if ($detail) { $state = "error: " + $detail }
    }
    "retry" { $state = "retrying " + $ProgressWord }
    "busy" { $state = "typing " + $ProgressWord }
    default { $state = "idle" }
  }

  $text = "$where - $state"
  if ($text.Length -gt 63) { $text = $text.Substring(0, 60) + "..." }
  return $text
}

function Save-ModeRequest {
  # The renderer is picked by the plugin, so a host menu item only leaves a
  # request behind. The plugin reads it, stores the choice and replaces the host.
  param([string]$Mode)

  try {
    $target = Join-Path $script:StateDirPath "mode.request"
    Write-JsonFile -Path $target -Json (ConvertTo-JsonCompact ([ordered]@{ mode = $Mode }))
    Write-PopupLog ("requested mode=$Mode")
  } catch { }
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
