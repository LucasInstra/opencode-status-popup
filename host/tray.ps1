# System tray icon. ASCII only, see common.ps1.
#
# Event handlers only see $script: state and file level functions, see window.ps1.

function New-TrayFrame {
  param(
    [int]$Size,
    [double]$Fill,
    [int]$Alpha,
    [int[]]$Rgb
  )

  if (-not $Rgb -or $Rgb.Count -lt 3) { $Rgb = @(0x7A, 0xC0, 0xFF) }

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $pad = [double][Math]::Max(1.0, $Size * 0.09)
    $side = [double]($Size - (2 * $pad))
    if ($side -le 2) { $side = $Size - 2; $pad = 1.0 }

    $rect = New-Object System.Drawing.RectangleF([float]$pad, [float]$pad, [float]$side, [float]$side)
    $radius = [float]($side * 0.28)
    $d = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
      $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
      $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
      $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
      $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
      $path.CloseFigure()

      $color = [System.Drawing.Color]::FromArgb($Alpha, $Rgb[0], $Rgb[1], $Rgb[2])

      if ($Fill -gt 0) {
        $state = $graphics.Save()
        try {
          $graphics.SetClip($path)
          $width = [float]($side * [Math]::Min(1.0, [Math]::Max(0.0, $Fill)))
          $brush = New-Object System.Drawing.SolidBrush($color)
          try {
            $graphics.FillRectangle($brush, [float]$rect.X, [float]$rect.Y, $width, [float]$rect.Height)
          } finally { $brush.Dispose() }
        } finally { $graphics.Restore($state) }
      }

      $penWidth = [float][Math]::Max(1.0, $Size * 0.075)
      $pen = New-Object System.Drawing.Pen($color, $penWidth)
      try { $graphics.DrawPath($pen, $path) } finally { $pen.Dispose() }
    } finally { $path.Dispose() }
  } finally {
    $graphics.Dispose()
  }

  $handle = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  return [pscustomobject]@{ Icon = $icon; Bitmap = $bmp; Handle = $handle }
}

function Update-TrayProgressIcon {
  $phase = $script:TrayPhase

  # Working phases animate the bar filling up as the word types itself out.
  if ($phase -eq "busy" -or $phase -eq "retry") {
    $script:TrayProgress = ($script:TrayProgress % $script:TraySteps) + 1
    $script:TrayNotifyIcon.Icon = $script:TrayFillFrames[$phase][$script:TrayProgress - 1].Icon
    return
  }

  # Waiting phases blink, faster the more the user is needed.
  $script:TrayProgress = 0
  $cadence = 4
  if ($phase -eq "permission") { $cadence = 1 }
  elseif ($phase -eq "error") { $cadence = 2 }

  $frames = $script:TrayBlinkFrames[$phase]
  if (-not $frames) { $frames = $script:TrayBlinkFrames["idle"] }

  $script:TrayBlink = ($script:TrayBlink + 1) % ($cadence * 2)
  if ($script:TrayBlink -lt $cadence) {
    $script:TrayNotifyIcon.Icon = $frames[0].Icon
  } else {
    $script:TrayNotifyIcon.Icon = $frames[1].Icon
  }
}

function Update-TrayTick {
  $agg = Get-AggregateState -FreshSeconds $script:TrayFresh
  $script:TrayTicks++

  if (($script:TrayTicks % 8) -eq 0) { Write-HostHeartbeat -Fields $script:TrayHostFields }

  if ($agg.Online) {
    $script:TrayMissingTicks = 0
  } else {
    $script:TrayMissingTicks++
    if (-not $script:TrayKeepAlive -and (($script:TrayMissingTicks * 0.25) -ge $script:TrayIdleSeconds)) {
      Write-PopupLog "no plugin heartbeat, closing tray"
      $script:TrayClosing = $true
      $script:TrayTimer.Stop()
      $script:TrayNotifyIcon.Visible = $false
      [System.Windows.Forms.Application]::ExitThread()
      return
    }
  }

  if ($agg.Phase -ne $script:TrayPhase) {
    $script:TrayPhase = $agg.Phase
    $script:TrayProgress = 0
  }

  Update-TrayProgressIcon

  $visible = $script:TrayWord
  $working = $script:TrayPhase -eq "busy" -or $script:TrayPhase -eq "retry"
  if ($working -and $script:TrayProgress -lt $script:TrayWord.Length) {
    $visible = $script:TrayWord.Substring(0, $script:TrayProgress)
  }

  $tooltip = Format-AggregateTooltip -Aggregate $agg -Word $script:TrayWord -ProgressWord $visible
  if ($tooltip -ne $script:TrayTooltip) {
    $script:TrayTooltip = $tooltip
    $script:TrayNotifyIcon.Text = $tooltip
  }
}

function Show-TrayIcon {
  param(
    [hashtable]$Settings,
    [switch]$KeepAlive
  )

  Add-Type -AssemblyName System.Windows.Forms, System.Drawing

  try { [void][PopupWin32.Native]::SetProcessDPIAware() } catch { }

  $script:TrayWord = $Settings.word
  if ([string]::IsNullOrEmpty($script:TrayWord)) { $script:TrayWord = "opencode" }
  $script:TrayFresh = [int]$Settings.fresh
  $script:TrayIdleSeconds = [int]$Settings.idle
  $script:TrayKeepAlive = [bool]$KeepAlive
  $script:TrayHostFields = @{
    mode   = "tray"
    word   = $script:TrayWord
    typeMs = [int]$Settings.typeMs
    fresh  = $script:TrayFresh
    idle   = $script:TrayIdleSeconds
  }

  $size = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width
  if ($size -lt 16) { $size = 16 }

  $palette = @{
    busy       = @(0x7A, 0xC0, 0xFF)
    retry      = @(0xFF, 0xB8, 0x6B)
    error      = @(0xFF, 0x7A, 0x7A)
    permission = @(0xC8, 0x96, 0xFF)
    idle       = @(0x7A, 0xC0, 0xFF)
  }

  $script:TraySteps = 8
  $script:TrayFillFrames = @{}
  foreach ($name in @("busy", "retry")) {
    $frames = @()
    for ($i = 1; $i -le $script:TraySteps; $i++) {
      $frames += (New-TrayFrame -Size $size -Fill ([double]$i / $script:TraySteps) -Alpha 255 -Rgb $palette[$name])
    }
    $script:TrayFillFrames[$name] = $frames
  }

  $script:TrayBlinkFrames = @{}
  foreach ($name in @("idle", "error", "permission")) {
    # Waiting states keep more brightness while blinking so the colour stays readable.
    $dimAlpha = 85
    if ($name -ne "idle") { $dimAlpha = 130 }
    $bright = New-TrayFrame -Size $size -Fill 1.0 -Alpha 235 -Rgb $palette[$name]
    $dim = New-TrayFrame -Size $size -Fill 1.0 -Alpha $dimAlpha -Rgb $palette[$name]
    $script:TrayBlinkFrames[$name] = @($bright, $dim)
  }

  $allFrames = @()
  foreach ($group in $script:TrayFillFrames.Values) { $allFrames += $group }
  foreach ($group in $script:TrayBlinkFrames.Values) { $allFrames += $group }

  $script:TrayProgress = 0
  $script:TrayBlink = 0
  $script:TrayTicks = 0
  $script:TrayMissingTicks = 0
  $script:TrayPhase = "idle"
  $script:TrayClosing = $false
  $script:TrayTooltip = "opencode"

  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = $script:TrayBlinkFrames["idle"][0].Icon
  $notify.Text = $script:TrayTooltip
  $notify.Visible = $true
  $script:TrayNotifyIcon = $notify

  $context = New-Object System.Windows.Forms.ApplicationContext

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $itemClose = $menu.Items.Add("Close")
  $itemClose.Add_Click({
    try {
      $script:TrayClosing = $true
      $script:TrayTimer.Stop()
      $script:TrayNotifyIcon.Visible = $false
      [System.Windows.Forms.Application]::ExitThread()
    } catch { }
  })
  $notify.ContextMenuStrip = $menu
  $script:TrayMenu = $menu

  $notify.Add_MouseClick({
    param($sender, $eventArgs)
    try {
      if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $script:TrayNotifyIcon.ShowBalloonTip(2500, "opencode", $script:TrayTooltip, [System.Windows.Forms.ToolTipIcon]::None)
      }
    } catch { }
  })

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 250
  $timer.Add_Tick({
    try { Update-TrayTick } catch { Write-PopupLog ("tray tick error: " + $_.Exception.Message) }
  })
  $script:TrayTimer = $timer

  Write-HostHeartbeat -Fields $script:TrayHostFields
  $timer.Start()

  try {
    [System.Windows.Forms.Application]::Run($context)
  } finally {
    try { $timer.Stop() } catch { }
    try { $notify.Visible = $false } catch { }
    try { $notify.Dispose() } catch { }
    try { $menu.Dispose() } catch { }
    foreach ($frame in $allFrames) {
      try { [void][PopupWin32.Native]::DestroyIcon($frame.Handle) } catch { }
      try { $frame.Icon.Dispose() } catch { }
      try { $frame.Bitmap.Dispose() } catch { }
    }
    Write-PopupLog "tray disposed"
  }
}
