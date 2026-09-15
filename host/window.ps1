# Always-on-top pill window. ASCII only, see common.ps1.
#
# PowerShell event handlers run outside the defining function scope, so every
# value they touch lives in $script: scope and every helper is a file level
# function.

function Set-PopupWord {
  param([int]$Count, [bool]$Idle)

  if ($Count -lt 0) { $Count = 0 }
  if ($Count -gt $script:PopWord.Length) { $Count = $script:PopWord.Length }

  $prefix = ""
  $tip = ""
  if ($Idle) {
    $prefix = $script:PopWord
  } elseif ($Count -gt 0) {
    $prefix = $script:PopWord.Substring(0, $Count - 1)
    $tip = $script:PopWord.Substring($Count - 1, 1)
  }

  if ($script:PopPrefix.Text -ne $prefix) { $script:PopPrefix.Text = $prefix }
  if ($script:PopTip.Text -ne $tip) { $script:PopTip.Text = $tip }
  if ($Idle) { $script:PopTip.Opacity = 1.0 }
}

function Set-PopupPhase {
  param($Aggregate)

  if ($Aggregate.Phase -eq "retry") {
    $script:PopTip.Foreground = $script:PopWarnBrush
    $script:PopShell.BorderBrush = $script:PopWarnBorder
  } else {
    $script:PopTip.Foreground = $script:PopAccentBrush
    $script:PopShell.BorderBrush = $script:PopSoftBorder
  }
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

function Update-PopupAnimation {
  if (-not $script:PopVisible -or $script:PopClosing) { return }

  if ($script:PopState.Phase -eq "idle") {
    $script:PopOpacityT = ($script:PopOpacityT + $script:PopTypeMs) % 2400
    $pulse = 0.60 + 0.40 * (0.5 + 0.5 * [Math]::Cos(2 * [Math]::PI * $script:PopOpacityT / 2400))
    $script:PopWindow.Opacity = $pulse
    $script:PopIndex = $script:PopWord.Length
    Set-PopupWord -Count $script:PopIndex -Idle $true
    return
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
  Set-PopupWord -Count $script:PopIndex -Idle $false
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

function Show-PopupWindow {
  param(
    [hashtable]$Settings,
    [string]$Position,
    [switch]$KeepAlive
  )

  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

  try { [void][PopupWin32.Native]::SetProcessDPIAware() } catch { }

  $script:PopWord = $Settings.word
  if ([string]::IsNullOrEmpty($script:PopWord)) { $script:PopWord = "opencode" }
  $script:PopTypeMs = [int]$Settings.typeMs
  $script:PopFreshSeconds = [int]$Settings.fresh
  $script:PopIdleSeconds = [int]$Settings.idle
  $script:PopPosition = $Position
  $script:PopKeepAlive = [bool]$KeepAlive
  $script:PopHostFields = @{
    mode   = "window"
    word   = $script:PopWord
    typeMs = $script:PopTypeMs
    fresh  = $script:PopFreshSeconds
    idle   = $script:PopIdleSeconds
  }

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

  $script:PopAccentBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0x7A, 0xC0, 0xFF))
  $script:PopWarnBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0xFF, 0xB8, 0x6B))
  $script:PopSoftBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x30, 0xFF, 0xFF, 0xFF))
  $script:PopWarnBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x66, 0xFF, 0xB8, 0x6B))

  $script:PopIndex = 0
  $script:PopHold = 0
  $script:PopBlink = 0
  $script:PopOpacityT = 0.0
  $script:PopState = [pscustomobject]@{ Phase = "idle"; Busy = 0; Retry = 0; Writers = 0; Projects = @() }
  $script:PopSignature = ""
  $script:PopMissingTicks = 0
  $script:PopHeartbeatTicks = 0
  $script:PopVisible = $false
  $script:PopClosing = $false

  $menu = New-Object System.Windows.Controls.ContextMenu

  $itemReset = New-Object System.Windows.Controls.MenuItem
  $itemReset.Header = "Reset position"
  $itemReset.Add_Click({
    try {
      if ([System.IO.File]::Exists($script:WindowStatePath)) { [System.IO.File]::Delete($script:WindowStatePath) }
      Set-PopupPosition
    } catch { }
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
  [void]$menu.Items.Add($itemClose)
  $script:PopWindow.ContextMenu = $menu

  $script:PopWindow.Add_MouseLeftButtonDown({
    try {
      $script:PopWindow.DragMove()
      Save-WindowState -Left $script:PopWindow.Left -Top $script:PopWindow.Top
    } catch { }
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
    try { Save-WindowState -Left $script:PopWindow.Left -Top $script:PopWindow.Top } catch { }
  })

  $anim = New-Object System.Windows.Threading.DispatcherTimer
  $anim.Interval = [TimeSpan]::FromMilliseconds($script:PopTypeMs)
  $anim.Add_Tick({ try { Update-PopupAnimation } catch { } })

  $stateTimer = New-Object System.Windows.Threading.DispatcherTimer
  $stateTimer.Interval = [TimeSpan]::FromMilliseconds(250)
  $stateTimer.Add_Tick({ try { Update-PopupState } catch { } })

  Write-HostHeartbeat -Fields $script:PopHostFields
  $stateTimer.Start()
  $anim.Start()

  try {
    [void]$script:PopWindow.ShowDialog()
  } finally {
    Write-PopupLog "window closed"
  }
}
