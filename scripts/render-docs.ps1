# Renders the README images straight from the real popup XAML, off screen.
#
#   pwsh -Sta -File scripts/render-docs.ps1
#
# Outputs into docs/: states.png, typing.png, tray.png and the raw frame dumps
# that scripts/build-gif.mjs turns into typing.gif.
#
# ASCII only, see host/common.ps1.

param(
  [string]$OutDir = ""
)

$root = Join-Path $PSScriptRoot ".."
$hostDir = Join-Path $root "host"

if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $root "docs" }
if (-not [System.IO.Directory]::Exists($OutDir)) { [void][System.IO.Directory]::CreateDirectory($OutDir) }

. (Join-Path $hostDir "common.ps1")
Initialize-PopupHost -StateDir (Join-Path $env:TEMP "opencode-status-popup-docs")
. (Join-Path $hostDir "window.ps1")
. (Join-Path $hostDir "tray.ps1")

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$script:DocWord = "opencode"
$script:PopWord = $script:DocWord
$null = New-PopupWindow

$script:DocBackdrop = [System.Drawing.Color]::FromArgb(255, 13, 13, 17)
$script:DocLabel = [System.Drawing.Color]::FromArgb(255, 139, 148, 158)
$script:DocFont = New-Object System.Drawing.Font("Segoe UI", 9.5)
$script:DocBoldFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)

function Render-Pill {
  param(
    [string]$Phase,
    [int]$Count,
    [bool]$Static,
    [string]$Suffix = ""
  )

  Set-PopupPhase -Aggregate ([pscustomobject]@{ Phase = $Phase })
  Set-PopupWord -Count $Count -Static $Static -Suffix $Suffix

  $border = $script:PopWindow.Content
  $border.Measure([System.Windows.Size]::new([double]::PositiveInfinity, [double]::PositiveInfinity))
  $border.Arrange([System.Windows.Rect]::new(0, 0, $border.DesiredSize.Width, $border.DesiredSize.Height))
  $border.UpdateLayout()

  $width = [int][Math]::Ceiling($border.DesiredSize.Width)
  $height = [int][Math]::Ceiling($border.DesiredSize.Height)
  $target = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($width, $height, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $target.Render($border)

  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($target))
  $stream = New-Object System.IO.MemoryStream
  $encoder.Save($stream)
  $stream.Position = 0

  # Copy out of the stream: a Bitmap keeps its source stream alive.
  $temporary = New-Object System.Drawing.Bitmap($stream)
  $bitmap = New-Object System.Drawing.Bitmap($temporary)
  $temporary.Dispose()
  $stream.Dispose()
  return $bitmap
}

function New-Canvas {
  param([int]$Width, [int]$Height)

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear($script:DocBackdrop)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return [pscustomobject]@{ Bitmap = $bitmap; Graphics = $graphics }
}

function Write-Frames {
  # Raw BGRA frames plus a json sidecar, consumed by scripts/build-gif.mjs.
  param(
    [System.Drawing.Bitmap[]]$Frames,
    [string]$Name,
    [int]$DelayMs
  )

  $dir = Join-Path $OutDir "frames"
  if (-not [System.IO.Directory]::Exists($dir)) { [void][System.IO.Directory]::CreateDirectory($dir) }

  $width = $Frames[0].Width
  $height = $Frames[0].Height
  $stream = New-Object System.IO.MemoryStream
  foreach ($frame in $Frames) {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
    $data = $frame.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $size = [Math]::Abs($data.Stride) * $height
      $buffer = New-Object byte[] $size
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buffer, 0, $size)
      $stream.Write($buffer, 0, $size)
    } finally {
      $frame.UnlockBits($data)
    }
  }

  [System.IO.File]::WriteAllBytes((Join-Path $dir "$Name.frames"), $stream.ToArray())
  $stream.Dispose()

  $meta = [ordered]@{
    width   = $width
    height  = $height
    frames  = $Frames.Count
    delayMs = $DelayMs
    format  = "bgra"
  }
  [System.IO.File]::WriteAllText((Join-Path $dir "$Name.json"), ($meta | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))

  $size = [Math]::Round((Get-Item (Join-Path $dir "$Name.frames")).Length / 1KB)
  return "  frames/$Name.frames: $($Frames.Count) frames, ${width}x${height}, ${size} KB"
}

# ---------------------------------------------------------------------------
# 1. states.png: every phase side by side, with labels
# ---------------------------------------------------------------------------
$states = @(
  @{ Phase = "idle"; Count = $script:DocWord.Length; Static = $true; Suffix = ""; Label = "idle" },
  @{ Phase = "busy"; Count = 5; Static = $false; Suffix = ""; Label = "busy" },
  @{ Phase = "retry"; Count = 5; Static = $false; Suffix = ""; Label = "retry" },
  @{ Phase = "error"; Count = $script:DocWord.Length; Static = $true; Suffix = "!"; Label = "error" },
  @{ Phase = "permission"; Count = $script:DocWord.Length; Static = $true; Suffix = "?"; Label = "permission" }
)

$cellWidth = 230
$canvas = New-Canvas -Width ($cellWidth * $states.Count) -Height 128
foreach ($state in $states) {
  $index = [array]::IndexOf($states, $state)
  $pill = Render-Pill -Phase $state.Phase -Count $state.Count -Static $state.Static -Suffix $state.Suffix
  $x = ($index * $cellWidth) + 18
  $canvas.Graphics.DrawImageUnscaled($pill, $x, 6)
  $pill.Dispose()
  $label = New-Object System.Drawing.SolidBrush($script:DocLabel)
  $canvas.Graphics.DrawString($state.Label, $script:DocBoldFont, $label, [float]$x, [float]96)
  $label.Dispose()
}
$canvas.Graphics.Dispose()
$statesPath = Join-Path $OutDir "states.png"
$canvas.Bitmap.Save($statesPath, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Bitmap.Dispose()
"states.png: $((Get-Item $statesPath).Length / 1KB -as [int]) KB"

# ---------------------------------------------------------------------------
# 2. typing.png: the typing loop as a storyboard
# ---------------------------------------------------------------------------
$typingCanvas = New-Canvas -Width (185 * 8) -Height 118
$arrowPen = New-Object System.Drawing.Pen($script:DocLabel, 1)
foreach ($count in 1..8) {
  $pill = Render-Pill -Phase "busy" -Count $count -Static $false
  $x = (($count - 1) * 185) + 12
  $typingCanvas.Graphics.DrawImageUnscaled($pill, $x, 10)
  $pill.Dispose()
  if ($count -lt 8) {
    $arrowX = $x + 150
    $typingCanvas.Graphics.DrawLine($arrowPen, $arrowX, 60, ($arrowX + 14), 60)
    $typingCanvas.Graphics.DrawLine($arrowPen, ($arrowX + 9), 56, ($arrowX + 14), 60)
    $typingCanvas.Graphics.DrawLine($arrowPen, ($arrowX + 9), 64, ($arrowX + 14), 60)
  }
}
$arrowPen.Dispose()
$typingCanvas.Graphics.Dispose()
$typingPath = Join-Path $OutDir "typing.png"
$typingCanvas.Bitmap.Save($typingPath, [System.Drawing.Imaging.ImageFormat]::Png)
$typingCanvas.Bitmap.Dispose()
"typing.png: $((Get-Item $typingPath).Length / 1KB -as [int]) KB"

# ---------------------------------------------------------------------------
# 3. tray.png: the real tray icon bitmaps, large and at real size
# ---------------------------------------------------------------------------
$iconSize = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width
if ($iconSize -lt 16) { $iconSize = 16 }

$palette = @{
  busy       = @(0x7A, 0xC0, 0xFF)
  retry      = @(0xFF, 0xB8, 0x6B)
  error      = @(0xFF, 0x7A, 0x7A)
  permission = @(0xC8, 0x96, 0xFF)
  idle       = @(0x7A, 0xC0, 0xFF)
}

$trayFrames = @()
for ($i = 1; $i -le 8; $i++) { $trayFrames += (New-TrayFrame -Size $iconSize -Fill ([double]$i / 8) -Alpha 255 -Rgb $palette["busy"]) }
for ($i = 1; $i -le 8; $i++) { $trayFrames += (New-TrayFrame -Size $iconSize -Fill ([double]$i / 8) -Alpha 255 -Rgb $palette["retry"]) }
foreach ($name in @("error", "permission", "idle")) {
  $trayFrames += (New-TrayFrame -Size $iconSize -Fill 1.0 -Alpha 235 -Rgb $palette[$name])
}

$scale = 8
$big = $iconSize * $scale
$gap = 8
$trayCanvas = New-Canvas -Width (($big + $gap) * $trayFrames.Count + $gap) -Height ($big + $iconSize + ($gap * 3))
$trayCanvas.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$trayCanvas.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$index = 0
foreach ($frame in $trayFrames) {
  $x = $gap + ($index * ($big + $gap))
  $largeRect = [System.Drawing.Rectangle]::new($x, $gap, $big, $big)
  $trayCanvas.Graphics.DrawImage($frame.Bitmap, $largeRect)
  $smallY = ($gap * 2) + $big
  $smallRect = [System.Drawing.Rectangle]::new($x, $smallY, $iconSize, $iconSize)
  $trayCanvas.Graphics.DrawImage($frame.Bitmap, $smallRect)
  $index++
}
$trayCanvas.Graphics.Dispose()
$trayPath = Join-Path $OutDir "tray.png"
$trayCanvas.Bitmap.Save($trayPath, [System.Drawing.Imaging.ImageFormat]::Png)
$trayCanvas.Bitmap.Dispose()
"tray.png: $((Get-Item $trayPath).Length / 1KB -as [int]) KB"

# ---------------------------------------------------------------------------
# 4. raw frames for the gif
# ---------------------------------------------------------------------------
$typingFrames = @()
foreach ($count in 1..8) { $typingFrames += (Render-Pill -Phase "busy" -Count $count -Static $false) }
foreach ($i in 1..4) { $typingFrames += (Render-Pill -Phase "busy" -Count 8 -Static $false) }

$frameWidth = 0
$frameHeight = 0
foreach ($frame in $typingFrames) {
  if ($frame.Width -gt $frameWidth) { $frameWidth = $frame.Width }
  if ($frame.Height -gt $frameHeight) { $frameHeight = $frame.Height }
}
$frameWidth += 8
$frameHeight += 4

$padded = @()
foreach ($frame in $typingFrames) {
  $plate = New-Canvas -Width $frameWidth -Height $frameHeight
  $plate.Graphics.DrawImageUnscaled($frame, 4, 2)
  $plate.Graphics.Dispose()
  $padded += $plate.Bitmap
  $frame.Dispose()
}
Write-Frames -Frames $padded -Name "typing" -DelayMs 130
foreach ($frame in $padded) { $frame.Dispose() }

"done -> $OutDir"
