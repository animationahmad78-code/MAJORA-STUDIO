param(
  [string]$Dotnet = "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe",
  [string]$DotnetEf = "$env:LOCALAPPDATA\MajoraTools\dotnet-tools\dotnet-ef.exe"
)
$ErrorActionPreference = 'Stop'
$core = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = (Resolve-Path (Join-Path $core '..')).Path
$release = Join-Path $root '06-BUILDS-AND-RELEASES'
$project = Join-Path $core 'apps\web-api\Majora.WebApi.csproj'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss', [Globalization.CultureInfo]::InvariantCulture)
$env:DOTNET_ROOT = Split-Path $Dotnet
$env:PATH = "$env:DOTNET_ROOT;$env:PATH"
$packages = @()

Push-Location $core
try {
  npm run build -w @majora/web
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }

  foreach ($rid in @('win-x64', 'linux-x64')) {
    $folder = Join-Path $release "MAJORA-web-$rid-$stamp"
    & $Dotnet publish $project -c Release -r $rid --self-contained false -o $folder
    if ($LASTEXITCODE -ne 0) { throw "Publish failed for $rid." }
    $archive = "$folder.zip"
    Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $archive -CompressionLevel Optimal
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
    $packages += [pscustomobject]@{ file = (Split-Path $archive -Leaf); sha256 = $hash; runtime = $rid }
    Write-Output "$archive | SHA-256 $hash"
  }

  $sql = Join-Path $release "MAJORA-web-sqlserver-migrations-$stamp.sql"
  & $DotnetEf migrations script --idempotent --project $project --startup-project $project --context MajoraDb --output $sql
  if ($LASTEXITCODE -ne 0) { throw 'SQL Server migration script failed.' }
  $sqlHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sql).Hash
  Write-Output "$sql | SHA-256 $sqlHash"
  $sourceCommit = (& git -C $root rev-parse HEAD).Trim()
  $sourceDirty = @(& git -C $root status --porcelain).Count -gt 0
  $latestMigration = Get-ChildItem (Join-Path $core 'apps/web-api/Migrations') -Filter '*.cs' |
    Where-Object { $_.Name -match '^\d{14}_.+\.cs$' } | Sort-Object Name | Select-Object -Last 1 -ExpandProperty BaseName
  $manifest = [ordered]@{
    format = 1
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceCommit = $sourceCommit
    sourceHadUncommittedChanges = $sourceDirty
    latestMigration = $latestMigration
    packages = @($packages)
    sqlScript = [ordered]@{ file = (Split-Path $sql -Leaf); sha256 = $sqlHash }
  }
  $manifestPath = Join-Path $release "MAJORA-web-release-$stamp.json"
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Write-Output $manifestPath
} finally {
  Pop-Location
}
