# Uploads Lister to GitHub as one new version, using GitHub CLI only (no Git needed).
# GitHub then builds the Windows installer and publishes the website automatically.
# Usage:  powershell -ExecutionPolicy Bypass -File publish.ps1 -Repo yourname/lister -Message "What changed"
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Message = 'Update Lister'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe' }

# what goes online: the app, the Windows app wrapper, the build steps and the docs
$include = @('app', 'desktop\main.js', 'desktop\preload.js', 'desktop\package.json', 'desktop\build\icon.png',
             '.github\workflows', 'README.md', 'LICENSE', '.gitignore', 'server.ps1', 'widget.ps1', 'Start Lister.bat', 'publish.ps1')
$files = foreach ($item in $include) {
  $full = Join-Path $root $item
  if (Test-Path -LiteralPath $full -PathType Container) { Get-ChildItem -LiteralPath $full -Recurse -File }
  elseif (Test-Path -LiteralPath $full) { Get-Item -LiteralPath $full }
}

function Api([string]$method, [string]$path, $body) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    if ($body) { [System.IO.File]::WriteAllText($tmp, ($body | ConvertTo-Json -Depth 10 -Compress), (New-Object System.Text.UTF8Encoding $false)) }
    $ghArgs = @('api', '-X', $method, $path)
    if ($body) { $ghArgs += @('--input', $tmp) }
    $out = & $gh @ghArgs
    if ($LASTEXITCODE -ne 0) { throw "GitHub said no to $method $path" }
    if ($out) { return ($out -join "`n") | ConvertFrom-Json }
  } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}

# a brand-new repository has no history yet: give it a first file so there is something to build on
$head = $null
try { $head = (Api GET "repos/$Repo/git/ref/heads/main" $null).object.sha } catch { }
if (-not $head) {
  Write-Host 'Setting up the empty repository...'
  $readme = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $root 'README.md')))
  Api PUT "repos/$Repo/contents/README.md" @{ message = 'Start Lister'; content = $readme; branch = 'main' } | Out-Null
  $head = (Api GET "repos/$Repo/git/ref/heads/main" $null).object.sha
}

Write-Host "Uploading $(@($files).Count) files..."
$tree = foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
  $blob = Api POST "repos/$Repo/git/blobs" @{ content = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.FullName)); encoding = 'base64' }
  @{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
}
# a full snapshot: files removed here are removed online too
$newTree = Api POST "repos/$Repo/git/trees" @{ tree = @($tree) }
$commit = Api POST "repos/$Repo/git/commits" @{ message = $Message; tree = $newTree.sha; parents = @($head) }
Api PATCH "repos/$Repo/git/refs/heads/main" @{ sha = $commit.sha } | Out-Null
Write-Host "Done. New version uploaded: https://github.com/$Repo/commit/$($commit.sha)"
