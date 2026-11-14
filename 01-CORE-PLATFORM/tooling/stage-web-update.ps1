param(
  [Parameter(Mandatory)][string]$PackageZip,
  [Parameter(Mandatory)][string]$ExpectedSha256,
  [Parameter(Mandatory)][string]$ReleaseRoot
)
$ErrorActionPreference = 'Stop'
$zip = (Resolve-Path -LiteralPath $PackageZip).Path
$actualHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
if ($actualHash -ne $ExpectedSha256.Trim().ToUpperInvariant()) { throw 'Package SHA-256 does not match the release manifest. Nothing was extracted.' }
if (-not (Test-Path -LiteralPath $ReleaseRoot)) { New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null }
$root = (Resolve-Path -LiteralPath $ReleaseRoot).Path
$name = [IO.Path]::GetFileNameWithoutExtension($zip)
if ($name -notmatch '^MAJORA-web-(win|linux)-x64-\d{8}-\d{6}$') { throw 'Unexpected package name.' }
$target = Join-Path $root $name
if (Test-Path -LiteralPath $target) { throw 'This release is already staged. Existing release files were not changed.' }

$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$totalSize = 0
  foreach ($entry in $archive.Entries) {
    $path = $entry.FullName.Replace('\','/')
    if ($path.StartsWith('/') -or $path.Contains(':') -or $path.Split('/') -contains '..' -or -not $seen.Add($path)) { throw 'Unsafe or duplicate path in release package.' }
    $totalSize += $entry.Length
    if ($totalSize -gt 500MB) { throw 'Release package exceeds the permitted expanded size.' }
  }
  foreach ($required in @('Majora.WebApi.dll','wwwroot/index.html')) {
    if (-not $seen.Contains($required)) { throw "Release package is incomplete: $required" }
  }
} finally { $archive.Dispose() }

$incoming = Join-Path $root ('.incoming-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $zip -DestinationPath $incoming
foreach ($required in @('Majora.WebApi.dll','wwwroot/index.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $incoming $required))) { throw "Extracted release is incomplete: $required" }
}
Move-Item -LiteralPath $incoming -Destination $target
Write-Output "STAGED: $target"
Write-Output 'The running site, database, and key directory were not changed. Switch the site only after a tested database backup, migration review, and health check.'
