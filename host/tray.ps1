# System tray icon. ASCII only, see common.ps1.
#
# Event handlers only see $script: state and file level functions, see window.ps1.

# The official OpenCode mark: an outlined square with a block inside, taken from
# the favicon. Coordinates below are the 512x512 viewBox values.

function New-OpenCodeMarkMask {
  # White mark on transparent, rendered once at a higher resolution so the
  # frames can be tinted and scaled down with antialiasing.
  param([int]$Pixels)

  $bitmap = New-Object System.Drawing.Bitmap($Pixels, $Pixels, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Mark bounds: x 128..384, y 96..416 (256x320). Hole: 192..320 x 160..352.
    $padding = [Math]::Max(1.0, $Pixels * 0.04)
    $scale = ($Pixels - (2 * $padding)) / 320.0
    $left = [float](($Pixels - (256 * $scale)) / 2)
    $top = [float](($Pixels - (320 * $scale)) / 2)

    $outer = [System.Drawing.RectangleF]::new($left, $top, [float](256 * $scale), [float](320 * $scale))
    $hole = [System.Drawing.RectangleF]::new(
      [float]($left + (64 * $scale)),
      [float]($top + (64 * $scale)),
      [float](128 * $scale),
      [float](192 * $scale))
    $block = [System.Drawing.RectangleF]::new(
      [float]($left + (64 * $scale)),
      [float]($top + (128 * $scale)),
      [float](128 * $scale),
      [float](128 * $scale))

    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    try {
      $graphics.FillRectangle($white, $outer)
      # Punch the hole, then draw the block that sits inside it.
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $clear = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Transparent)
      try { $graphics.FillRectangle($clear, $hole) } finally { $clear.Dispose() }
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.FillRectangle($white, $block)
    } finally { $white.Dispose() }
  } finally {
    $graphics.Dispose()
  }

  return $bitmap
}

function New-TintAttributes {
  param(
    [int[]]$Rgb,
    [double]$Alpha
  )

  $matrix = New-Object System.Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = [float]($Rgb[0] / 255.0)
  $matrix.Matrix11 = [float]($Rgb[1] / 255.0)
  $matrix.Matrix22 = [float]($Rgb[2] / 255.0)
  $matrix.Matrix33 = [float]$Alpha
  $matrix.Matrix44 = 1.0

  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetColorMatrix($matrix)
  return $attributes
}

function New-MarkFrame {
  # One tray icon: the mark in the given colour. A negative angle draws the
  # plain mark (brightness only), otherwise a bright wedge sweeps over a dim mark.
  param(
    [int]$Size,
    [double]$Angle = -1,
    [double]$BrightAlpha = 1.0,
    [double]$DimAlpha = 0.55,
    [double]$WedgeDegrees = 110,
    [int[]]$Rgb
  )

  $mask = $script:TrayMarkMask
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $destination = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
    $source = [System.Drawing.Rectangle]::new(0, 0, $mask.Width, $mask.Height)
    $unit = [System.Drawing.GraphicsUnit]::Pixel

    if ($Angle -ge 0) {
      $dimAttributes = New-TintAttributes -Rgb $Rgb -Alpha $DimAlpha
      try { $graphics.DrawImage($mask, $destination, 0, 0, $mask.Width, $mask.Height, $unit, $dimAttributes) } finally { $dimAttributes.Dispose() }

      $wedge = New-Object System.Drawing.Drawing2D.GraphicsPath
      try {
        $radius = $Size * 1.5
        $wedge.AddPie(
          [float](($Size / 2) - $radius),
          [float](($Size / 2) - $radius),
          [float]($radius * 2),
          [float]($radius * 2),
          [float]$Angle,
          [float]$WedgeDegrees)
        $graphics.SetClip($wedge)
        $brightAttributes = New-TintAttributes -Rgb $Rgb -Alpha $BrightAlpha
        try { $graphics.DrawImage($mask, $destination, 0, 0, $mask.Width, $mask.Height, $unit, $brightAttributes) } finally { $brightAttributes.Dispose() }
        $graphics.ResetClip()
      } finally { $wedge.Dispose() }
    } else {
      $attributes = New-TintAttributes -Rgb $Rgb -Alpha $BrightAlpha
      try { $graphics.DrawImage($mask, $destination, 0, 0, $mask.Width, $mask.Height, $unit, $attributes) } finally { $attributes.Dispose() }
    }
  } finally {
    $graphics.Dispose()
  }

  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  return [pscustomobject]@{ Icon = $icon; Bitmap = $bitmap; Handle = $handle }
}

function Update-TrayProgressIcon {
  $phase = $script:TrayPhase

  # Working phases sweep a bright wedge around the mark.
  if ($phase -eq "busy" -or $phase -eq "retry") {
    $script:TrayProgress = ($script:TrayProgress % $script:TraySweepSteps) + 1
    $script:TrayNotifyIcon.Icon = $script:TraySweepFrames[$phase][$script:TrayProgress - 1].Icon
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
  if ($working) {
    # The tooltip tracks the sweep so the word still grows while it works.
    $ratio = $script:TrayProgress / $script:TraySweepSteps
    $chars = [Math]::Max(1, [int][Math]::Round($ratio * $script:TrayWord.Length))
    if ($chars -lt $script:TrayWord.Length) {
      $visible = $script:TrayWord.Substring(0, $chars)
    }
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

  $script:TrayMarkMask = New-OpenCodeMarkMask -Pixels ([Math]::Min(256, $size * 8))

  $script:TraySweepSteps = 12
  $script:TraySweepFrames = @{}
  foreach ($name in @("busy", "retry")) {
    $frames = @()
    for ($i = 0; $i -lt $script:TraySweepSteps; $i++) {
      $angle = (360.0 * $i) / $script:TraySweepSteps
      $frames += (New-MarkFrame -Size $size -Angle $angle -Rgb $palette[$name])
    }
    $script:TraySweepFrames[$name] = $frames
  }

  $script:TrayBlinkFrames = @{}
  foreach ($name in @("idle", "error", "permission")) {
    $bright = New-MarkFrame -Size $size -BrightAlpha 0.95 -Rgb $palette[$name]
    $dim = New-MarkFrame -Size $size -BrightAlpha 0.35 -Rgb $palette[$name]
    $script:TrayBlinkFrames[$name] = @($bright, $dim)
  }

  $allFrames = @()
  foreach ($group in $script:TraySweepFrames.Values) { $allFrames += $group }
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
