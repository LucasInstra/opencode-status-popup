# Always-on-top pill window. ASCII only, see common.ps1.
#
# PowerShell event handlers run outside the defining function scope, so every
# value they touch lives in $script: scope and every helper is a file level
# function.

function Set-PopupWord {
  param(
    [int]$Count,
    [bool]$Static,
    [string]$Suffix = ""
  )

  if ($Static) {
    if ($script:PopPrefix.Text -ne $script:PopWord) { $script:PopPrefix.Text = $script:PopWord }
    if ($script:PopTip.Text -ne $Suffix) { $script:PopTip.Text = $Suffix }
    $script:PopTip.Opacity = 1.0
    return
  }

  if ($Count -lt 0) { $Count = 0 }
  if ($Count -gt $script:PopWord.Length) { $Count = $script:PopWord.Length }

  $prefix = ""
  $tip = ""
  if ($Count -gt 0) {
    $prefix = $script:PopWord.Substring(0, $Count - 1)
    $tip = $script:PopWord.Substring($Count - 1, 1)
  }

  if ($script:PopPrefix.Text -ne $prefix) { $script:PopPrefix.Text = $prefix }
  if ($script:PopTip.Text -ne $tip) { $script:PopTip.Text = $tip }
}

function Set-PopupPhase {
  param($Aggregate)

  $accent = $script:PopWhiteBrush
  $border = $script:PopSoftBorder
  $suffix = ""
  $pulseMs = 2400
  $pulseMin = 0.60

  switch ($Aggregate.Phase) {
    "permission" {
      $accent = $script:PopVioletBrush
      $border = $script:PopVioletBorder
      $suffix = "?"
      $pulseMs = 1000
      $pulseMin = 0.70
    }
    "error" {
      $accent = $script:PopRedBrush
      $border = $script:PopRedBorder
      $suffix = "!"
      $pulseMs = 1500
      $pulseMin = 0.72
    }
    "retry" {
      $accent = $script:PopAmberBrush
      $border = $script:PopAmberBorder
    }
    "busy" {
      $accent = $script:PopBlueBrush
    }
  }

  $script:PopAccent = $accent
  $script:PopSuffix = $suffix
  $script:PopPulseMs = $pulseMs
  $script:PopPulseMin = $pulseMin
  $script:PopTip.Foreground = $accent
  if ($script:PopMark) { $script:PopMark.Fill = $accent }
  $script:PopShell.BorderBrush = $border
}

function Set-PopupPosition {
  $work = [System.Windows.SystemParameters]::WorkArea
  $window = $script:PopWindow
  $width = $window.ActualWidth
  $height = $window.ActualHeight
  if ($width -le 0) { $width = 180 }
  if ($height -le 0) { $height = 60 }

  $margin = 8
  $saved = Read-WindowState
  if ($null -ne $saved) {
    $left = [double]$saved.left
    $top = [double]$saved.top
    # Keep a visible slice on screen if the monitor layout changed.
    if ($left -gt ($work.Right - 80)) { $left = $work.Right - $width - $margin }
    if ($left -lt ($work.Left - $width + 80)) { $left = $work.Left + $margin }
    if ($top -gt ($work.Bottom - 40)) { $top = $work.Bottom - $height - $margin }
    if ($top -lt ($work.Top - $height + 40)) { $top = $work.Top + $margin }
    $window.Left = $left
    $window.Top = $top
    return
  }

  switch ($script:PopPosition) {
    "bottom-left" {
      $window.Left = $work.Left + $margin
      $window.Top = $work.Bottom - $height - $margin - 26
    }
    "top-right" {
      $window.Left = $work.Right - $width - $margin
      $window.Top = $work.Top + $margin
    }
    "top-left" {
      $window.Left = $work.Left + $margin
      $window.Top = $work.Top + $margin
    }
    default {
      $window.Left = $work.Right - $width - $margin
      $window.Top = $work.Bottom - $height - $margin - 26
    }
  }
}

function Save-PopupPosition {
  # Remembers where the pill is, so it reopens there. The periodic timer and the
  # close both call this, which covers a host that is killed without closing.
  try {
    $left = $script:PopWindow.Left
    $top = $script:PopWindow.Top
    if ($left -eq $script:PopSavedLeft -and $top -eq $script:PopSavedTop) { return }
    $script:PopSavedLeft = $left
    $script:PopSavedTop = $top
    Save-WindowState -Left $left -Top $top
  } catch { }
}

# The breathing runs on the WPF composition clock: smooth on screen and no per
# tick work in PowerShell. BeginAnimation takes the property over until it is
# cleared again.
function Start-PopupPulse {
  $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
  $animation.From = $script:PopPulseMin
  $animation.To = 1.0
  $animation.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds([Math]::Max(120, $script:PopPulseMs / 2)))
  $animation.AutoReverse = $true
  $animation.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
  try {
    $animation.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
  } catch { }
  $script:PopWindow.BeginAnimation([System.Windows.Window]::OpacityProperty, $animation)
}

function Stop-PopupPulse {
  $script:PopWindow.BeginAnimation([System.Windows.Window]::OpacityProperty, $null)
  $script:PopWindow.Opacity = 1.0
}

function Update-PopupAnimation {
  if (-not $script:PopVisible -or $script:PopClosing) { return }

  $phase = $script:PopState.Phase

  # States that are not "work in progress": show the whole word and breathe.
  if ($phase -eq "idle" -or $phase -eq "error" -or $phase -eq "permission") {
    if (-not $script:PopPulsing) {
      $script:PopPulsing = $true
      Start-PopupPulse
    }
    Set-PopupWord -Count $script:PopWord.Length -Static $true -Suffix $script:PopSuffix
    return
  }

  if ($script:PopPulsing) {
    $script:PopPulsing = $false
    Stop-PopupPulse
  }
  $script:PopWindow.Opacity = 1.0
  $script:PopBlink = ($script:PopBlink + 1) % 6
  if ($script:PopBlink -lt 3) { $script:PopTip.Opacity = 1.0 } else { $script:PopTip.Opacity = 0.35 }

  if ($script:PopIndex -ge $script:PopWord.Length) {
    $script:PopHold++
    if ($script:PopHold -ge 6) {
      $script:PopIndex = 0
      $script:PopHold = 0
    }
  } else {
    $script:PopIndex++
  }
  Set-PopupWord -Count $script:PopIndex -Static $false
}

function Update-PopupState {
  $agg = Get-AggregateState -FreshSeconds $script:PopFreshSeconds
  $sig = Get-AggregateSignature -Aggregate $agg
  if ($sig -ne $script:PopSignature) {
    $script:PopSignature = $sig
    $script:PopState = $agg
    Set-PopupPhase -Aggregate $agg
  }

  $script:PopHeartbeatTicks++
  if (($script:PopHeartbeatTicks % 8) -eq 0) { Write-HostHeartbeat -Fields $script:PopHostFields }

  if ($agg.Online) {
    $script:PopMissingTicks = 0
    return
  }

  $script:PopMissingTicks++
  if (-not $script:PopKeepAlive -and (($script:PopMissingTicks * 0.25) -ge $script:PopIdleSeconds)) {
    Write-PopupLog "no plugin heartbeat, closing window"
    $script:PopClosing = $true
    $script:PopWindow.Close()
  }
}

function New-PopupWindow {
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

  $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="opencode status"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False"
        ResizeMode="NoResize" SizeToContent="WidthAndHeight"
        WindowStartupLocation="Manual" SnapsToDevicePixels="True">
  <Border x:Name="Shell" Margin="14" CornerRadius="14" Padding="16,8"
          Background="#E9141418" BorderBrush="#30FFFFFF" BorderThickness="1">
    <Border.Effect>
      <DropShadowEffect BlurRadius="14" ShadowDepth="2" Opacity="0.55" Color="#000000" />
    </Border.Effect>
    <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
      <Path x:Name="Mark" Data="M0,0 H12 V14 H0 Z M2,2 H10 V12 H2 Z" Fill="#FF7AC0FF"
            VerticalAlignment="Center" Margin="0,0,9,0" />
      <TextBlock x:Name="PrefixText" FontFamily="Cascadia Mono, Consolas, Courier New"
                 FontSize="19" FontWeight="SemiBold" Foreground="#FFF3F5F7" />
      <TextBlock x:Name="TipText" FontFamily="Cascadia Mono, Consolas, Courier New"
                 FontSize="19" FontWeight="SemiBold" Foreground="#FF7AC0FF" />
    </StackPanel>
  </Border>
</Window>
'@

  $script:PopWindow = [System.Windows.Markup.XamlReader]::Parse($xaml)
  $script:PopShell = $script:PopWindow.FindName("Shell")
  $script:PopPrefix = $script:PopWindow.FindName("PrefixText")
  $script:PopTip = $script:PopWindow.FindName("TipText")
  $script:PopMark = $script:PopWindow.FindName("Mark")
  if ($null -eq $script:PopMarkEnabled) { $script:PopMarkEnabled = $false }
  if (-not $script:PopMarkEnabled) {
    $script:PopMark.Visibility = [System.Windows.Visibility]::Collapsed
  }

  $script:PopBlueBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0x7A, 0xC0, 0xFF))
  $script:PopAmberBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0xFF, 0xB8, 0x6B))
  $script:PopRedBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0xFF, 0x7A, 0x7A))
  $script:PopVioletBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0xC8, 0x96, 0xFF))
  $script:PopWhiteBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0xF3, 0xF5, 0xF7))

  $script:PopSoftBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x30, 0xFF, 0xFF, 0xFF))
  $script:PopAmberBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x88, 0xFF, 0xB8, 0x6B))
  $script:PopRedBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x88, 0xFF, 0x7A, 0x7A))
  $script:PopVioletBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x88, 0xC8, 0x96, 0xFF))

  $script:PopAccent = $script:PopWhiteBrush
  $script:PopSuffix = ""
  $script:PopPulseMs = 2400
  $script:PopPulseMin = 0.60

  return $script:PopWindow
}

function Show-PopupWindow {
  param(
    [hashtable]$Settings,
    [string]$Position,
    [switch]$KeepAlive
  )

  try { [void][PopupWin32.Native]::SetProcessDPIAware() } catch { }

  $script:PopWord = $Settings.word
  if ([string]::IsNullOrEmpty($script:PopWord)) { $script:PopWord = "opencode" }
  $script:PopTypeMs = [int]$Settings.typeMs
  $script:PopFreshSeconds = [int]$Settings.fresh
  $script:PopIdleSeconds = [int]$Settings.idle
  $script:PopPosition = $Position
  $script:PopKeepAlive = [bool]$KeepAlive
  $script:PopMarkEnabled = [bool]$Settings.mark
  $script:PopHostFields = @{
    mode   = "window"
    word   = $script:PopWord
    typeMs = $script:PopTypeMs
    fresh  = $script:PopFreshSeconds
    idle   = $script:PopIdleSeconds
    mark   = $script:PopMarkEnabled
  }

  $window = New-PopupWindow

  $script:PopIndex = 0
  $script:PopHold = 0
  $script:PopBlink = 0
  $script:PopPulsing = $false
  $script:PopState = [pscustomobject]@{ Phase = "idle"; Busy = 0; Retry = 0; Errors = 0; Permissions = 0; Detail = ""; Writers = 0; Projects = @() }
  $script:PopSignature = ""
  $script:PopMissingTicks = 0
  $script:PopHeartbeatTicks = 0
  $script:PopVisible = $false
  $script:PopClosing = $false
  $script:PopSavedLeft = [double]::NaN
  $script:PopSavedTop = [double]::NaN

  $menu = New-Object System.Windows.Controls.ContextMenu

  $itemReset = New-Object System.Windows.Controls.MenuItem
  $itemReset.Header = "Reset position"
  $itemReset.Add_Click({
    try {
      if ([System.IO.File]::Exists($script:WindowStatePath)) { [System.IO.File]::Delete($script:WindowStatePath) }
      Set-PopupPosition
    } catch { }
  })

  $itemTray = New-Object System.Windows.Controls.MenuItem
  $itemTray.Header = "Show in tray"
  $itemTray.Add_Click({
    try { Save-ModeRequest -Mode "tray" } catch { }
  })

  $itemClose = New-Object System.Windows.Controls.MenuItem
  $itemClose.Header = "Close"
  $itemClose.Add_Click({
    try {
      $script:PopClosing = $true
      $script:PopWindow.Close()
    } catch { }
  })

  [void]$menu.Items.Add($itemReset)
  [void]$menu.Items.Add($itemTray)
  [void]$menu.Items.Add($itemClose)
  $script:PopWindow.ContextMenu = $menu

  # A click and a drag share the left button, the same split the tray icon
  # uses: DragMove keeps the cursor at the same spot inside the window, so the
  # window moving past the system drag distance is what tells them apart. A
  # click brings the OpenCode terminal forward, a drag just moves the pill.
  $script:PopWindow.Add_MouseLeftButtonDown({
    try {
      $left = $script:PopWindow.Left
      $top = $script:PopWindow.Top
      $script:PopWindow.DragMove()
      Save-PopupPosition

      $dragX = [System.Windows.SystemParameters]::MinimumHorizontalDragDistance
      $dragY = [System.Windows.SystemParameters]::MinimumVerticalDragDistance
      if ($dragX -le 0) { $dragX = 4 }
      if ($dragY -le 0) { $dragY = 4 }
      $movedX = [Math]::Abs($script:PopWindow.Left - $left)
      $movedY = [Math]::Abs($script:PopWindow.Top - $top)
      if ($movedX -ge $dragX -or $movedY -ge $dragY) { return }

      $targetPid = 0
      if ($null -ne $script:PopState) { $targetPid = [int]$script:PopState.Pid }
      if ($targetPid -gt 0 -and (Focus-OpenCodeWindow -ProcessId $targetPid)) {
        Write-PopupLog ("focus terminal pid={0}" -f $targetPid)
      } else {
        Write-PopupLog ("focus terminal failed pid={0}" -f $targetPid)
      }
    } catch {
      Write-PopupLog ("pill click error: " + $_.Exception.Message)
    }
  })

  $script:PopWindow.Add_SourceInitialized({
    try {
      $helper = New-Object System.Windows.Interop.WindowInteropHelper($script:PopWindow)
      $hwnd = $helper.Handle
      $GWL_EXSTYLE = -20
      $WS_EX_TOOLWINDOW = 0x00000080
      $ex = [PopupWin32.Native]::GetWindowLong($hwnd, $GWL_EXSTYLE)
      [void][PopupWin32.Native]::SetWindowLong($hwnd, $GWL_EXSTYLE, ($ex -bor $WS_EX_TOOLWINDOW))
    } catch { }
  })

  $script:PopWindow.Add_Loaded({
    try {
      Set-PopupPosition
      Set-PopupPhase -Aggregate $script:PopState
      $script:PopWindow.Opacity = 0.0
      $script:PopVisible = $true
      Write-PopupLog ("window shown at {0},{1}" -f [int]$script:PopWindow.Left, [int]$script:PopWindow.Top)
    } catch {
      Write-PopupLog ("loaded error: " + $_.Exception.Message)
    }
  })

  $script:PopWindow.Add_Closed({
    try {
      Save-PopupPosition
    } catch { }
  })

  $anim = New-Object System.Windows.Threading.DispatcherTimer
  $anim.Interval = [TimeSpan]::FromMilliseconds($script:PopTypeMs)
  $anim.Add_Tick({ try { Update-PopupAnimation } catch { } })

  $script:PopSaveTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:PopSaveTimer.Interval = [TimeSpan]::FromMilliseconds(2000)
  $script:PopSaveTimer.Add_Tick({ try { Save-PopupPosition } catch { } })

  $stateTimer = New-Object System.Windows.Threading.DispatcherTimer
  $stateTimer.Interval = [TimeSpan]::FromMilliseconds(250)
  $stateTimer.Add_Tick({ try { Update-PopupState } catch { } })

  Write-HostHeartbeat -Fields $script:PopHostFields
  $stateTimer.Start()
  $anim.Start()
  $script:PopSaveTimer.Start()

  try {
    [void]$script:PopWindow.ShowDialog()
  } finally {
    Write-PopupLog "window closed"
  }
}
