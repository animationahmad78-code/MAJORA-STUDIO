param(
  [Parameter(Mandatory)][string]$PublishDirectory,
  [string]$DotnetRoot = "$env:LOCALAPPDATA\MajoraTools\dotnet"
)
$ErrorActionPreference = 'Stop'
$binary = Join-Path $PublishDirectory 'Majora.WebApi.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw "Windows published executable not found: $binary" }
$id = [guid]::NewGuid().ToString('N')
$port = 5199
$base = "http://127.0.0.1:$port"
$log = Join-Path $env:TEMP "majora-package-test-$id.log"
$envVars = @{
  ASPNETCORE_ENVIRONMENT = 'Development'
  ASPNETCORE_URLS = $base
  ConnectionStrings__Sqlite = "Data Source=$env:TEMP\majora-package-test-$id.db"
  MAJORA_BOOTSTRAP_USER = "admin_$id"
  MAJORA_BOOTSTRAP_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  DOTNET_ROOT = $DotnetRoot
}
$process = Start-Process -FilePath $binary -WorkingDirectory $PublishDirectory -Environment $envVars -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $health = Invoke-RestMethod "$base/api/health" -TimeoutSec 2
      if ($health.status -eq 'ok') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw "Published app did not start. Log: $log" }
  $page = Invoke-WebRequest $base -TimeoutSec 5
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html') { throw 'Published web UI was not served.' }
  Write-Output 'PASS: published executable served health endpoint and React entry page.'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
