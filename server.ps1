# Lister local server: serves the app folder at http://127.0.0.1:5317/ on this laptop only.
# It also passes the focus timer between the app and the desktop timer (widget.ps1)
# through a small file in %LOCALAPPDATA%\Lister. Started by "Start Lister.bat". Close this window to stop it.
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$port = 5317
$url = "http://127.0.0.1:$port/"
$app = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app')) + [System.IO.Path]::DirectorySeparatorChar
$dataDir = Join-Path $env:LOCALAPPDATA 'Lister'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$timerFile = Join-Path $dataDir 'timer.json'
$pingFile = Join-Path $dataDir 'ping.txt'

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try { $listener.Start() }
catch {
  Write-Host "Lister is already running. Opening it..."
  if (-not $NoOpen) { Start-Process $url }
  exit
}
Write-Host "Lister is running at $url"
Write-Host "Keep this window open (you can minimize it). Close it to stop Lister."
if (-not $NoOpen) { Start-Process $url }

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'; '.json' = 'application/json'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'
}
$utf8 = New-Object System.Text.UTF8Encoding $false
$logFile = Join-Path $dataDir 'server-log.txt'
Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format s) started (pid $PID)"

trap {
  # anything that stops the server is written down, so we can see why it closed
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format s) stopped: $($_ | Out-String)"
  break
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
    $line = $reader.ReadLine()
    $len = 0
    while ($true) {
      $h = $reader.ReadLine()
      if ($null -eq $h -or $h -eq '') { break }
      if ($h -match '^Content-Length:\s*(\d+)') { $len = [int]$Matches[1] }
    }
    $method = 'GET'; $path = '/'
    if ($line -match '^(\S+) (\S+)') { $method = $Matches[1]; $path = $Matches[2] }
    $path = [Uri]::UnescapeDataString(($path -split '[?#]')[0])
    if ($path -eq '/') { $path = '/index.html' }
    $status = '200 OK'; $type = 'application/json'

    if ($path -eq '/api/timer') {
      if ($method -eq 'POST') {
        # the app sends plain ASCII JSON (non-ASCII is \u-escaped), so characters = bytes
        $buf = New-Object char[] $len; $read = 0
        while ($read -lt $len) { $n = $reader.Read($buf, $read, $len - $read); if ($n -le 0) { break }; $read += $n }
        if ($read -gt 0) { [System.IO.File]::WriteAllText($timerFile, (New-Object string ($buf, 0, $read)), $utf8) }
        $body = $utf8.GetBytes('{"ok":true}')
      } else {
        $txt = '{}'
        if (Test-Path -LiteralPath $timerFile) { $txt = [System.IO.File]::ReadAllText($timerFile) }
        $body = $utf8.GetBytes($txt)
      }
    } elseif ($path -eq '/api/ping') {
      # the app pings while it is on screen, so the desktop timer can stay out of the way
      [System.IO.File]::WriteAllText($pingFile, [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $utf8)
      $body = $utf8.GetBytes('{"ok":true}')
    } else {
      $file = [System.IO.Path]::GetFullPath((Join-Path $app $path.TrimStart('/')))
      if (($method -eq 'GET' -or $method -eq 'HEAD') -and $file.StartsWith($app) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($file)
        $type = $types[[System.IO.Path]::GetExtension($file).ToLower()]
        if (-not $type) { $type = 'application/octet-stream' }
      } else {
        $body = $utf8.GetBytes('Not found'); $status = '404 Not Found'; $type = 'text/plain'
      }
    }
    $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  } catch {
    # a browser opened a connection and sent nothing; drop it
  } finally {
    $client.Close()
  }
}
