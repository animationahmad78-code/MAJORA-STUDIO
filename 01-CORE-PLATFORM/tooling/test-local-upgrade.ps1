param(
  [Parameter(Mandatory)][string]$Backup,
  [Parameter(Mandatory)][string]$PublishDirectory,
  [string]$Dotnet = "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe"
)
$ErrorActionPreference = 'Stop'
$backupPath = (Resolve-Path -LiteralPath $Backup).Path
$publishedPath = (Resolve-Path -LiteralPath $PublishDirectory).Path
$snapshotTool = Join-Path $PSScriptRoot 'sqlite-snapshot\bin\Release\net10.0\SqliteSnapshot.dll'
$executable = Join-Path $publishedPath 'Majora.WebApi.exe'
if (-not (Test-Path -LiteralPath $snapshotTool) -or -not (Test-Path -LiteralPath $executable)) { throw 'Snapshot tool or published app is missing.' }
$id = [guid]::NewGuid().ToString('N')
$testDb = Join-Path $env:TEMP "majora-upgrade-$id.db"
$log = Join-Path $env:TEMP "majora-upgrade-$id.log"
$address = 'http://127.0.0.1:5191'
& $Dotnet $snapshotTool $backupPath $testDb
if ($LASTEXITCODE -ne 0) { throw 'Could not make a disposable upgrade copy.' }
$before = & $Dotnet $snapshotTool --inspect $testDb | ConvertFrom-Json
$environment = @{
  ASPNETCORE_ENVIRONMENT = 'Development'
  Database__Provider = 'Sqlite'
  ConnectionStrings__Sqlite = "Data Source=$testDb"
  AllowedHosts = 'localhost;127.0.0.1'
  DOTNET_ROOT = Split-Path $Dotnet
}
$process = Start-Process -FilePath $executable -WorkingDirectory $publishedPath -ArgumentList @('--urls',$address) -Environment $environment -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { if ((Invoke-RestMethod "$address/api/health" -TimeoutSec 2).status -eq 'ok') { $ready = $true; break } } catch { Start-Sleep -Milliseconds 500 }
    if ($process.HasExited) { break }
  }
  if (-not $ready) { throw "Upgrade copy did not start. Log: $log.err" }
  if ((Invoke-WebRequest $address -TimeoutSec 5).StatusCode -ne 200) { throw 'Upgraded copy did not serve its UI.' }
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
$after = & $Dotnet $snapshotTool --inspect $testDb | ConvertFrom-Json
foreach ($table in @('Tenants','Users','Products','Customers','Invoices','InvoiceLines')) {
  if ($before.$table -ne $after.$table) { throw "Upgrade copy changed row count in $table. Test DB: $testDb" }
}
Write-Output "PASS: disposable upgrade; health/UI; core row counts preserved. Test DB: $testDb"
