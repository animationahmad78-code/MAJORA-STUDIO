$ErrorActionPreference = 'Stop'
$address = 'http://127.0.0.1:5188'
$appFolder = $PSScriptRoot
$executable = Join-Path $appFolder 'Majora.WebApi.exe'
$runtime = Join-Path $env:LOCALAPPDATA 'MajoraTools\dotnet'
$dataFolder = Join-Path $env:LOCALAPPDATA 'MAJORA\LocalWeb'
$database = Join-Path $dataFolder 'majora-local.db'

if (-not (Test-Path -LiteralPath $executable)) { throw 'فایل اجرایی ماژورا پیدا نشد.' }
if (-not (Test-Path -LiteralPath $database)) { throw 'پایگاه دادهٔ محلی پیدا نشد. برای جلوگیری از ساخت فضای خالی، برنامه اجرا نشد.' }
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'dotnet.exe'))) { throw 'پیش‌نیاز .NET در مسیر نصب‌شده پیدا نشد.' }

function Test-MajoraReady {
    try {
        $result = Invoke-RestMethod "$address/api/health" -TimeoutSec 2
        return $result.status -eq 'ok'
    } catch { return $false }
}

if (-not (Test-MajoraReady)) {
    $env:DOTNET_ROOT = $runtime
    $env:DOTNET_ROOT_X64 = $runtime
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:Database__Provider = 'Sqlite'
    $env:ConnectionStrings__Sqlite = "Data Source=$database"
    $env:AllowedHosts = 'localhost;127.0.0.1'
    $env:Logging__LogLevel__Default = 'Warning'
    $env:Logging__LogLevel__Microsoft = 'Warning'
    $stdout = Join-Path $dataFolder 'server-out.log'
    $stderr = Join-Path $dataFolder 'server-error.log'
    $serverProcess = Start-Process -FilePath $executable -WorkingDirectory $appFolder -ArgumentList @('--urls', $address) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-MajoraReady) { $ready = $true; break }
        if ($serverProcess.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "ماژورا راه‌اندازی نشد. گزارش خطا: $stderr" }
}

Start-Process $address
