param([string]$Mode = "window", [int]$Busy = 1, [int]$Retry = 0)

$dir = Join-Path $env:TEMP "opencode-status-popup"
$stateDir = Join-Path $dir "state"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$payload = [ordered]@{
  version  = 1
  instance = "preview"
  pid      = 0
  project  = "preview"
  mode     = $Mode
  busy     = $Busy
  retry    = $Retry
  updated  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Set-Content -Path (Join-Path $stateDir "preview.json") -Value ($payload | ConvertTo-Json -Compress) -NoNewline -Encoding utf8

$host_ = Join-Path $PSScriptRoot "..\host\popup.ps1"
& pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -Sta -File $host_ -Mode $Mode -StateDir $dir -KeepAlive *> (Join-Path $dir "test-$Mode.out")
"exit=$LASTEXITCODE"
