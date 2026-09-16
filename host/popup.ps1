# opencode status popup host.
#
# Renders the presence files written by the opencode-status-popup plugin.
# Two modes: a frameless always-on-top pill ("window") or a system tray icon
# ("tray"). Exactly one host runs at a time, guarded by a named mutex.
#
# ASCII only on purpose, see common.ps1.

[CmdletBinding()]
param(
  [ValidateSet("window", "tray")]
  [string]$Mode = "window",
  [string]$StateDir = "",
  [string]$MutexName = "Local\opencode-status-popup-host",
  [int]$Mark = 0,
  [string]$Word = "opencode",
  [int]$TypeMs = 140,
  [ValidateSet("bottom-right", "bottom-left", "top-right", "top-left")]
  [string]$Position = "bottom-right",
  [int]$FreshSeconds = 20,
  [int]$IdleSeconds = 25,
  [switch]$KeepAlive
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
. (Join-Path $PSScriptRoot "window.ps1")
. (Join-Path $PSScriptRoot "tray.ps1")

Initialize-PopupHost -StateDir $StateDir

if ([string]::IsNullOrWhiteSpace($Word)) { $Word = "opencode" }
if ($TypeMs -lt 40) { $TypeMs = 40 }

Write-PopupLog ("start mode={0} pid={1} word={2} typeMs={3} position={4} state={5}" -f $Mode, $PID, $Word, $TypeMs, $Position, $script:StateDirPath)

# ---------------------------------------------------------------------------
# Single instance guard. A second host exits immediately: the first one keeps
# rendering every presence file, including the ones from the newer instance.
# ---------------------------------------------------------------------------
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)
$holding = $createdNew
if (-not $createdNew) {
  try {
    $holding = $mutex.WaitOne(5000)
  } catch [System.Threading.AbandonedMutexException] {
    # The previous host was killed while holding the mutex. We own it now.
    Write-PopupLog "took over an abandoned host"
    $holding = $true
  } catch {
    $holding = $false
  }
  if (-not $holding) {
    Write-PopupLog "another host is already running, exiting"
    $mutex.Dispose()
    exit 0
  }
}

$settings = @{
  mode    = $Mode
  word    = $Word
  typeMs  = $TypeMs
  fresh   = $FreshSeconds
  idle    = $IdleSeconds
  mark    = ([int]$Mark -ne 0)
  state   = $script:StateDirPath
}

try {
  switch ($Mode) {
    "tray" { Show-TrayIcon -Settings $settings -KeepAlive:$KeepAlive }
    default { Show-PopupWindow -Settings $settings -Position $Position -KeepAlive:$KeepAlive }
  }
  Write-PopupLog "exit clean"
} catch {
  Write-PopupLog ("fatal: " + $_.Exception.ToString())
  exit 1
} finally {
  if ($holding) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  try { $mutex.Dispose() } catch { }
}

exit 0
