# Lister desktop timer: a small always-on-top clock in the bottom-right corner of the screen.
# It reads the focus timer from %LOCALAPPDATA%\Lister\timer.json (written by the app through server.ps1),
# keeps counting when Lister is minimized or closed, and hides itself while Lister is on screen.
# Started by "Start Lister.bat". Right-click it and choose "Quit desktop timer" to stop it.
$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $env:LOCALAPPDATA 'Lister'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$timerFile = Join-Path $dataDir 'timer.json'
$pingFile = Join-Path $dataDir 'ping.txt'
$appUrl = 'http://127.0.0.1:5317/#focus'

# only one desktop timer at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ListerDesktopTimer', [ref]$created)
if (-not $created) { exit }

$logFile = Join-Path $dataDir 'widget-log.txt'
Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format s) started (pid $PID)"
try {
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Lister timer" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize" SizeToContent="WidthAndHeight"
        Visibility="Hidden" ShowActivated="False">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Foreground" Value="#EEF1F7"/>
      <Setter Property="Background" Value="#232848"/>
      <Setter Property="FontFamily" Value="Segoe UI Semibold"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Margin" Value="0,0,0,5"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="B" Background="{TemplateBinding Background}" CornerRadius="7" Padding="12,4">
              <ContentPresenter HorizontalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="B" Property="Background" Value="#343C78"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Border x:Name="Card" CornerRadius="16" Background="#F0141922" BorderBrush="#40FFFFFF" BorderThickness="1" Padding="16,10,10,10" Margin="10">
    <Border.Effect><DropShadowEffect BlurRadius="18" ShadowDepth="3" Opacity="0.45"/></Border.Effect>
    <Border.ContextMenu>
      <ContextMenu>
        <MenuItem x:Name="OpenItem" Header="Open Lister"/>
        <MenuItem x:Name="QuitItem" Header="Quit desktop timer"/>
      </ContextMenu>
    </Border.ContextMenu>
    <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <StackPanel Grid.Column="0" MinWidth="150" VerticalAlignment="Center">
        <TextBlock x:Name="Mode" Foreground="#8E98AA" FontSize="11" FontFamily="Segoe UI Semibold" Text="FOCUSING"/>
        <TextBlock x:Name="Time" Foreground="#F4F6FB" FontSize="38" FontFamily="JetBrains Mono, Cascadia Mono, Consolas" FontWeight="Bold" Text="25:00" Margin="0,-2,0,0"/>
        <TextBlock x:Name="Task" Foreground="#8C96FF" FontSize="12" FontFamily="Segoe UI" TextTrimming="CharacterEllipsis" MaxWidth="170"/>
      </StackPanel>
      <StackPanel Grid.Column="1" VerticalAlignment="Center" Margin="12,0,0,0">
        <Button x:Name="PauseBtn" Content="Pause"/>
        <Button x:Name="OpenBtn" Content="Open"/>
        <Button x:Name="HideBtn" Content="Hide" Margin="0"/>
      </StackPanel>
    </Grid>
  </Border>
</Window>
'@
$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}
foreach ($n in 'Card', 'Mode', 'Time', 'Task', 'PauseBtn', 'OpenBtn', 'HideBtn', 'OpenItem', 'QuitItem') { $ui[$n] = $win.FindName($n) }
$ui.Card.ContextMenu.PlacementTarget = $ui.Card
$ui.OpenItem = $ui.Card.ContextMenu.Items[0]
$ui.QuitItem = $ui.Card.ContextMenu.Items[1]

$script:state = $null
$script:lastWrite = [datetime]::MinValue
$script:alerted = ''
$script:hiddenFor = ''
$script:moved = $false

function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Load-State {
  if (-not (Test-Path -LiteralPath $timerFile)) { return }
  $w = (Get-Item -LiteralPath $timerFile).LastWriteTimeUtc
  if ($w -eq $script:lastWrite) { return }
  $script:lastWrite = $w
  try { $script:state = [System.IO.File]::ReadAllText($timerFile) | ConvertFrom-Json } catch { }
}
function Save-State {
  $script:state | Add-Member -NotePropertyName updated -NotePropertyValue (NowMs) -Force
  $json = $script:state | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($timerFile, $json, (New-Object System.Text.UTF8Encoding $false))
  $script:lastWrite = (Get-Item -LiteralPath $timerFile).LastWriteTimeUtc
}
function Remaining($s) {
  if ($s.running) { return [math]::Max(0, [double]$s.endsAt - (NowMs)) }
  return [double]$s.remaining
}
function Place {
  # keep it tucked into the bottom-right corner until you drag it somewhere else
  if ($script:moved -or $win.ActualWidth -le 0) { return }
  $wa = [System.Windows.SystemParameters]::WorkArea
  $left = $wa.Right - $win.ActualWidth - 6
  $top = $wa.Bottom - $win.ActualHeight - 6
  if ([math]::Abs($win.Left - $left) -gt 1) { $win.Left = $left }
  if ([math]::Abs($win.Top - $top) -gt 1) { $win.Top = $top }
}
function Open-Lister { Start-Process $appUrl }

$ui.Card.Add_MouseLeftButtonDown({ $script:moved = $true; $win.DragMove() })
$ui.OpenBtn.Add_Click({ Open-Lister })
$ui.OpenItem.Add_Click({ Open-Lister })
$ui.QuitItem.Add_Click({ $script:wpf.Shutdown() })
$ui.HideBtn.Add_Click({
  $s = $script:state
  if ($s) { $script:hiddenFor = "$($s.mode)|$($s.endsAt)|$($s.remaining)|$($s.running)" }
  $win.Visibility = 'Hidden'
})
function Next-Mode($s) {
  # same order as the app: focus, short break ... and a long break after the last round
  $rounds = if ($s.rounds) { [int]$s.rounds } else { 4 }
  if ($s.mode -eq 'work') { $next = if ([int]$s.round -ge $rounds) { 'long' } else { 'short' } }
  else { if ($s.mode -eq 'long') { $s.round = 1 } else { $s.round = [int]$s.round + 1 }; $next = 'work' }
  $len = if ($s.lengths -and $s.lengths.$next) { [double]$s.lengths.$next } else { @{ work = 1500000; short = 300000; long = 900000 }[$next] }
  $s.mode = $next; $s.length = $len; $s.remaining = $len
  $s.endsAt = (NowMs) + $len; $s.running = $true
}
function Record-Done($s) {
  # remember the finished focus session so the app can add it to the Tracker later
  if ($s.mode -ne 'work') { return }
  $id = "w$($s.endsAt)"
  $list = @(); if ($s.completed) { $list = @($s.completed) }
  if ($list | Where-Object { $_.id -eq $id }) { return }
  $list += [pscustomobject]@{ id = $id; at = [double]$s.endsAt; minutes = [math]::Round([double]$s.length / 60000); taskId = [string]$s.taskId }
  $s | Add-Member -NotePropertyName completed -NotePropertyValue $list -Force
  Save-State
}
$ui.PauseBtn.Add_Click({
  $s = $script:state
  if (-not $s) { return }
  if ($s.running -and (Remaining $s) -le 0) { Next-Mode $s; Save-State; return }
  if ($s.running) {
    $s.remaining = Remaining $s
    $s.running = $false
  } else {
    if ([double]$s.remaining -le 0) { $s.remaining = $s.length }
    $s.endsAt = (NowMs) + [double]$s.remaining
    $s.running = $true
  }
  Save-State
})
$win.Add_SizeChanged({ Place })

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(250)
$timer.Add_Tick({
  try {
    Load-State
    $s = $script:state
    if (-not $s -or -not $s.mode) { $win.Visibility = 'Hidden'; return }
    $rem = Remaining $s
    $active = $s.running -or ([double]$s.remaining -lt [double]$s.length)
    $done = $s.running -and $rem -le 0
    $appOnScreen = $false
    if (Test-Path -LiteralPath $pingFile) {
      $appOnScreen = ((Get-Date).ToUniversalTime() - (Get-Item -LiteralPath $pingFile).LastWriteTimeUtc).TotalSeconds -lt 5
    }
    $key = "$($s.mode)|$($s.endsAt)|$($s.remaining)|$($s.running)"
    $show = $active -and ($done -or -not $appOnScreen) -and ($script:hiddenFor -ne $key)

    $sec = [math]::Ceiling($rem / 1000)
    $ui.Time.Text = '{0:00}:{1:00}' -f [math]::Min(99, [math]::Floor($sec / 60)), ($sec % 60)
    if ($done) {
      $ui.Mode.Text = if ($s.mode -eq 'work') { 'SESSION DONE - TIME FOR A BREAK' } else { 'BREAK IS OVER' }
      $ui.Mode.Foreground = '#4FD69C'
      $ui.PauseBtn.Visibility = 'Visible'
      $ui.PauseBtn.Content = if ($s.mode -eq 'work') { 'Start break' } else { 'Start focus' }
      if ($script:alerted -ne $key) {
        $script:alerted = $key
        [System.Media.SystemSounds]::Exclamation.Play()
        $show = $true; $script:hiddenFor = ''
        Record-Done $s
      }
    } else {
      $ui.Mode.Text = switch ($s.mode) { 'work' { if ($s.running) { 'FOCUSING' } else { 'PAUSED' } } 'short' { 'SHORT BREAK' } default { 'LONG BREAK' } }
      $ui.Mode.Foreground = if ($s.mode -eq 'work') { '#8E98AA' } else { '#4FD69C' }
      $ui.PauseBtn.Visibility = 'Visible'
      $ui.PauseBtn.Content = if ($s.running) { 'Pause' } else { 'Resume' }
    }
    $ui.Task.Text = [string]$s.taskTitle
    $ui.Task.Visibility = if ($s.taskTitle) { 'Visible' } else { 'Collapsed' }

    if ($show -and $win.Visibility -ne 'Visible') { $win.Visibility = 'Visible' }
    elseif (-not $show -and $win.Visibility -eq 'Visible') { $win.Visibility = 'Hidden' }
    if ($win.Visibility -eq 'Visible') { Place }
  } catch { }
})
$timer.Start()
$win.Add_Loaded({ Place })
# a plain message loop (not ShowDialog), so hiding the window doesn't end the program
$script:wpf = New-Object System.Windows.Application
$script:wpf.ShutdownMode = 'OnExplicitShutdown'
$win.Show(); $win.Visibility = 'Hidden'
[void]$script:wpf.Run()
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $dataDir 'widget-error.txt')
} finally {
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format s) stopped"
  $mutex.ReleaseMutex()
}
