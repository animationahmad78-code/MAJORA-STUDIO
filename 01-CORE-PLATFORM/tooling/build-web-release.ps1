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
    Write-Output "$archive | SHA-256 $hash"
  }

  $sql = Join-Path $release "MAJORA-web-sqlserver-migrations-$stamp.sql"
  & $DotnetEf migrations script --idempotent --project $project --startup-project $project --context MajoraDb --output $sql
  if ($LASTEXITCODE -ne 0) { throw 'SQL Server migration script failed.' }
  Write-Output "$sql | SHA-256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $sql).Hash)"
} finally {
  Pop-Location
}
