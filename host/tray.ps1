# System tray icon. ASCII only, see common.ps1.
#
# Event handlers only see $script: state and file level functions, see window.ps1.

# The tray icon is the "o" of the opencode wordmark (a square ring, same shape
# language as the logo) drawn on a pixel grid, built pixel by pixel while the
# agent works.

function Get-OpenCodeRingCells {
  # Cells of the ring, clockwise from the top left, so the letter looks like it
  # is being drawn. Six columns by seven rows, because the glyph of the wordmark
  # is taller than wide, with a stroke one cell thick and closed corners so the
  # o still reads as a blocky letter instead of a heavy square.
  param(
    [int]$Columns = 6,
    [int]$Rows = 7
  )

  $cells = New-Object System.Collections.Generic.List[object]
  for ($x = 0; $x -lt $Columns; $x++) { $cells.Add([pscustomobject]@{ X = $x; Y = 0 }) }
  for ($y = 1; $y -lt $Rows; $y++) { $cells.Add([pscustomobject]@{ X = ($Columns - 1); Y = $y }) }
  for ($x = ($Columns - 2); $x -ge 0; $x--) { $cells.Add([pscustomobject]@{ X = $x; Y = ($Rows - 1) }) }
  for ($y = ($Rows - 2); $y -ge 1; $y--) { $cells.Add([pscustomobject]@{ X = 0; Y = $y }) }
  return $cells
}

function New-LetterFrame {
  # One tray icon: the first VisibleCells pixels of the ring, or the whole
  # letter when VisibleCells is the ring size.
  param(
    [int]$Size,
    [int]$VisibleCells,
    [int[]]$Rgb,
    [double]$Alpha = 1.0
  )

  $cells = $script:TrayRingCells
  if (-not $cells) { $cells = Get-OpenCodeRingCells }
  $columns = $script:TrayRingColumns
  $rows = $script:TrayRingRows
  if (-not $columns) { $columns = 6 }
  if (-not $rows) { $rows = 7 }

  # One cell of stroke. Keep cells at two pixels or more so the letter stays
  # readable in a 16px tray slot.
  $cell = [Math]::Max(2, [Math]::Floor(($Size - 1) / $rows))
  $gridWidth = $columns * $cell
  $gridHeight = $rows * $cell
  $originX = [Math]::Floor(($Size - $gridWidth) / 2)
  $originY = [Math]::Floor(($Size - $gridHeight) / 2)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    # Crisp pixels: no smoothing on axis aligned blocks.
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    $color = [System.Drawing.Color]::FromArgb([int][Math]::Round(255 * $Alpha), $Rgb[0], $Rgb[1], $Rgb[2])
    $brush = New-Object System.Drawing.SolidBrush($color)

    try {
      $count = [Math]::Min($VisibleCells, $cells.Count)
      for ($index = 0; $index -lt $count; $index++) {
        $target = $cells[$index]
        $x = $originX + ($target.X * $cell)
        $y = $originY + ($target.Y * $cell)
        $graphics.FillRectangle($brush, [int]$x, [int]$y, $cell, $cell)
      }
    } finally { $brush.Dispose() }
  } finally {
    $graphics.Dispose()
  }

  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  return [pscustomobject]@{ Icon = $icon; Bitmap = $bitmap; Handle = $handle }
}

function Update-TrayProgressIcon {
  $phase = $script:TrayPhase

  # Working phases draw the letter pixel by pixel.
  if ($phase -eq "busy" -or $phase -eq "retry") {
    $total = $script:TrayRingCells.Count
    if ($script:TrayProgress -ge $total) {
      $script:TrayHold++
      if ($script:TrayHold -ge 2) {
        # Back to a couple of pixels, not zero: an empty icon reads as a glitch.
        $script:TrayProgress = [Math]::Min(2, $total)
        $script:TrayHold = 0
      }
    } else {
      $script:TrayProgress = [Math]::Min($total, $script:TrayProgress + $script:TrayBuildStep)
    }
    $script:TrayTrayIcon.Update($script:TrayBuildFrames[$phase][$script:TrayProgress].Icon)
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
    $script:TrayTrayIcon.Update($frames[0].Icon)
  } else {
    $script:TrayTrayIcon.Update($frames[1].Icon)
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
      $script:TrayTrayIcon.Hide()
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
    # The tooltip tracks the pixel build so the word grows with the letter.
    $total = $script:TrayRingCells.Count
    $ratio = $script:TrayProgress / $total
    $chars = [Math]::Max(1, [int][Math]::Round($ratio * $script:TrayWord.Length))
    if ($chars -lt $script:TrayWord.Length) {
      $visible = $script:TrayWord.Substring(0, $chars)
    }
  }

  $tooltip = Format-AggregateTooltip -Aggregate $agg -Word $script:TrayWord -ProgressWord $visible
  if ($tooltip -ne $script:TrayTooltip) { $script:TrayTooltip = $tooltip }
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

  $script:TrayRingCells = Get-OpenCodeRingCells
  $script:TrayBuildFrames = @{}
  foreach ($name in @("busy", "retry")) {
    $frames = @()
    # Index 0 is the empty icon, used only if the phase starts from nothing.
    for ($visible = 0; $visible -le $script:TrayRingCells.Count; $visible++) {
      $frames += (New-LetterFrame -Size $size -VisibleCells $visible -Rgb $palette[$name])
    }
    $script:TrayBuildFrames[$name] = $frames
  }

  $script:TrayBlinkFrames = @{}
  foreach ($name in @("idle", "error", "permission")) {
    $bright = New-LetterFrame -Size $size -VisibleCells $script:TrayRingCells.Count -Rgb $palette[$name] -Alpha 0.95
    $dim = New-LetterFrame -Size $size -VisibleCells $script:TrayRingCells.Count -Rgb $palette[$name] -Alpha 0.35
    $script:TrayBlinkFrames[$name] = @($bright, $dim)
  }

  $allFrames = @()
  foreach ($group in $script:TrayBuildFrames.Values) { $allFrames += $group }
  foreach ($group in $script:TrayBlinkFrames.Values) { $allFrames += $group }

  $script:TrayProgress = 0
  $script:TrayHold = 0
  $script:TrayBlink = 0
  $script:TrayTicks = 0
  $script:TrayMissingTicks = 0
  $script:TrayPhase = "idle"
  $script:TrayClosing = $false
  $script:TrayTooltip = "opencode"
  $script:TrayRingColumns = 6
  $script:TrayRingRows = 7
  # Pixels per tick, tuned so a full build takes about the same time whatever
  # the ring size ends up being.
  $script:TrayBuildStep = [Math]::Max(2, [int][Math]::Ceiling($script:TrayRingCells.Count / 10))

  # One fixed GUID for this plugin: the shell keys the tray settings (including
  # where the user dragged the icon) on it, so they survive restarts.
  $script:TrayIconIdentity = "8f2b1c4e-7d3a-4f5b-9c6e-2a1d0b9f77c3"

  if (-not ("TrayIconHost" -as [type])) {
    $references = @(
      [System.Windows.Forms.Form].Assembly.Location
      [System.Windows.Forms.Message].Assembly.Location
      [System.Drawing.Icon].Assembly.Location
      [System.Drawing.Point].Assembly.Location
    ) | Select-Object -Unique
    Add-Type -Path (Join-Path $PSScriptRoot "TrayIcon.cs") -ReferencedAssemblies $references
  }

  # Context menu, opened from the raw tray callback (see TrayIcon.cs).
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $itemClose = $menu.Items.Add("Close")
  $itemClose.Add_Click({
    try {
      $script:TrayClosing = $true
      $script:TrayTimer.Stop()
      $script:TrayTrayIcon.Hide()
      [System.Windows.Forms.Application]::ExitThread()
    } catch { }
  })
  $script:TrayMenu = $menu

  $script:TrayTrayIcon = New-Object TrayIconHost -ArgumentList ([Guid]$script:TrayIconIdentity), "opencode-status-popup"
  $script:TrayTrayIcon.add_RightClick({
    try { $script:TrayMenu.Show([System.Windows.Forms.Cursor]::Position) } catch { }
  })
  $script:TrayTrayIcon.add_LeftClick({
    try { $script:TrayTrayIcon.ShowBalloon("opencode", $script:TrayTooltip) } catch { }
  })

  $registered = $script:TrayTrayIcon.Show($script:TrayBlinkFrames["idle"][0].Icon)
  Write-PopupLog ("tray icon registered={0} guid={1}" -f $registered, $script:TrayIconIdentity)

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 250
  $timer.Add_Tick({
    try { Update-TrayTick } catch { Write-PopupLog ("tray tick error: " + $_.Exception.Message) }
  })
  $script:TrayTimer = $timer

  Write-HostHeartbeat -Fields $script:TrayHostFields
  $timer.Start()

  try {
    [System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
  } finally {
    try { $timer.Stop() } catch { }
    try { $script:TrayTrayIcon.Dispose() } catch { }
    try { $script:TrayMenu.Dispose() } catch { }
    foreach ($frame in $allFrames) {
      try { [void][PopupWin32.Native]::DestroyIcon($frame.Handle) } catch { }
      try { $frame.Icon.Dispose() } catch { }
      try { $frame.Bitmap.Dispose() } catch { }
    }
    Write-PopupLog "tray disposed"
  }
}
