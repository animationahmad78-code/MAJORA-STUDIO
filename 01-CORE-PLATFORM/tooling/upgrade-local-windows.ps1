param(
  [Parameter(Mandatory)][string]$PublishDirectory,
  [string]$Dotnet = "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe"
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$release = (Resolve-Path -LiteralPath $PublishDirectory).Path
$backupRoot = (Resolve-Path -LiteralPath (Join-Path $root '07-BACKUPS')).Path
$dataRoot = (Resolve-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MAJORA\LocalWeb')).Path
$appFolder = (Resolve-Path -LiteralPath (Join-Path $dataRoot 'app')).Path
$database = (Resolve-Path -LiteralPath (Join-Path $dataRoot 'majora-local.db')).Path
$snapshotTool = Join-Path $PSScriptRoot 'sqlite-snapshot\bin\Release\net10.0\SqliteSnapshot.dll'
$address = 'http://127.0.0.1:5188'
$expectedApp = [IO.Path]::GetFullPath((Join-Path $dataRoot 'app'))
if (-not $appFolder.Equals($expectedApp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Resolved app folder is outside the intended local installation.' }
if ((Get-Item -LiteralPath $appFolder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Local app folder is a reparse point; upgrade stopped.' }
if (-not (Test-Path -LiteralPath (Join-Path $release 'Majora.WebApi.exe')) -or -not (Test-Path -LiteralPath $snapshotTool)) { throw 'Published app or snapshot tool is missing.' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss',[Globalization.CultureInfo]::InvariantCulture)
$databaseBackup = Join-Path $backupRoot "MAJORA-local-pre-install-$stamp.db"
$appBackup = Join-Path $backupRoot "MAJORA-local-app-pre-install-$stamp"
if (-not ([IO.Path]::GetFullPath($databaseBackup).StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) -or
    -not ([IO.Path]::GetFullPath($appBackup).StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))) { throw 'Backup targets are outside the backup folder.' }

function Start-LocalApp {
  $environment = @{
    DOTNET_ROOT = Split-Path $Dotnet
    DOTNET_ROOT_X64 = Split-Path $Dotnet
    ASPNETCORE_ENVIRONMENT = 'Development'
    Database__Provider = 'Sqlite'
    ConnectionStrings__Sqlite = "Data Source=$database"
    AllowedHosts = 'localhost;127.0.0.1'
    Logging__LogLevel__Default = 'Warning'
  }
  $process = Start-Process -FilePath (Join-Path $appFolder 'Majora.WebApi.exe') -WorkingDirectory $appFolder -ArgumentList @('--urls',$address) -Environment $environment -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataRoot 'server-out.log') -RedirectStandardError (Join-Path $dataRoot 'server-error.log')
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { if ((Invoke-RestMethod "$address/api/health" -TimeoutSec 2).status -eq 'ok') { return $process } } catch { Start-Sleep -Milliseconds 500 }
    if ($process.HasExited) { break }
  }
  throw 'Local app did not become healthy.'
}

$active = Get-NetTCPConnection -LocalPort 5188 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($active) {
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($active.OwningProcess)"
  $expectedExe = [IO.Path]::GetFullPath((Join-Path $appFolder 'Majora.WebApi.exe'))
  if (-not $current.ExecutablePath.Equals($expectedExe,[StringComparison]::OrdinalIgnoreCase)) { throw 'Port 5188 belongs to another program.' }
  Stop-Process -Id $current.ProcessId -Force
  for ($wait = 0; $wait -lt 20 -and (Get-Process -Id $current.ProcessId -ErrorAction SilentlyContinue); $wait++) { Start-Sleep -Milliseconds 250 }
}

& $Dotnet $snapshotTool $database $databaseBackup
if ($LASTEXITCODE -ne 0) { throw 'Pre-install database snapshot failed.' }
$before = & $Dotnet $snapshotTool --inspect $databaseBackup | ConvertFrom-Json
Copy-Item -LiteralPath $appFolder -Destination $appBackup -Recurse
if (-not (Test-Path -LiteralPath (Join-Path $appBackup 'Majora.WebApi.dll'))) { throw 'App rollback copy is incomplete.' }

$newProcess = $null
try {
  Get-ChildItem -LiteralPath $release -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $appFolder -Recurse -Force }
  $newProcess = Start-LocalApp
  if ((Invoke-WebRequest $address -TimeoutSec 5).StatusCode -ne 200) { throw 'Local UI was not served.' }
  $after = & $Dotnet $snapshotTool --inspect $database | ConvertFrom-Json
  foreach ($table in @('Tenants','Users','Products','Customers','Invoices','InvoiceLines')) {
    if ($before.$table -ne $after.$table) { throw "Installed upgrade changed row count in $table." }
  }
  $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $appFolder 'Majora.WebApi.dll')).Hash
  $releaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $release 'Majora.WebApi.dll')).Hash
  if ($installedHash -ne $releaseHash) { throw 'Installed DLL differs from the release.' }
  Write-Output "PASS: local installation upgraded; health/UI/data counts verified. DLL SHA-256 $installedHash"
  Write-Output "Database backup: $databaseBackup"
  Write-Output "App rollback copy: $appBackup"
} catch {
  $failure = $_
  if ($newProcess -and -not $newProcess.HasExited) { Stop-Process -Id $newProcess.Id -Force }
  Get-ChildItem -LiteralPath $appBackup -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $appFolder -Recurse -Force }
  foreach ($suffix in @('-wal','-shm')) {
    $sidecar = "$database$suffix"
    if ([IO.Path]::GetFullPath($sidecar).StartsWith($dataRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $sidecar)) { Remove-Item -LiteralPath $sidecar -Force }
  }
  Copy-Item -LiteralPath $databaseBackup -Destination $database -Force
  $null = Start-LocalApp
  throw "Local upgrade was rolled back: $failure"
}
