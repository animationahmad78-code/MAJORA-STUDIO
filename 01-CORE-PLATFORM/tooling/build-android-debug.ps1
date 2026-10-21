param(
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [Parameter(Mandatory = $true)][string]$SdkRoot
)

$ErrorActionPreference = 'Stop'
$core = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$studio = (Resolve-Path -LiteralPath (Join-Path $core '..')).Path
$javaExe = Join-Path $JavaHome 'bin/java.exe'
$androidJar = Join-Path $SdkRoot 'platforms/android-36/android.jar'
if (-not (Test-Path -LiteralPath $javaExe)) { throw "Java 21 پیدا نشد: $javaExe" }
if (-not (Test-Path -LiteralPath $androidJar)) { throw "Android SDK Platform 36 پیدا نشد: $androidJar" }
$javaVersion = (& $javaExe -version 2>&1 | Select-Object -First 1) -join ''
if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch '^(openjdk|java) version "21(?:[.+"]|$)') {
  throw "Capacitor 8 به Java 21 نیاز دارد. نسخهٔ داده‌شده: $javaVersion"
}

$oldJava = $env:JAVA_HOME
$oldAndroidHome = $env:ANDROID_HOME
$oldAndroidRoot = $env:ANDROID_SDK_ROOT
$oldLocation = (Get-Location).Path
try {
  $env:JAVA_HOME = (Resolve-Path -LiteralPath $JavaHome).Path
  $env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkRoot).Path
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  Set-Location -LiteralPath $core
  & npm test
  if ($LASTEXITCODE -ne 0) { throw 'آزمون‌ها شکست خوردند.' }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'ساخت وب شکست خورد.' }
  Set-Location -LiteralPath (Join-Path $core 'apps/mobile')
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'همگام‌سازی Android شکست خورد.' }
  Set-Location -LiteralPath (Join-Path $core 'apps/mobile/android')
  & .\gradlew.bat --no-daemon assembleDebug
  if ($LASTEXITCODE -ne 0) { throw 'ساخت Gradle شکست خورد.' }
  $apk = Join-Path (Get-Location).Path 'app/build/outputs/apk/debug/app-debug.apk'
  if (-not (Test-Path -LiteralPath $apk) -or (Get-Item -LiteralPath $apk).Length -eq 0) { throw 'APK خروجی پیدا نشد یا خالی است.' }
  $releaseDir = Join-Path $studio '06-BUILDS-AND-RELEASES/debug'
  New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
  $name = 'classicbag-debug-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.apk'
  $copy = Join-Path $releaseDir $name
  Copy-Item -LiteralPath $apk -Destination $copy
  $hash = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
  Write-Output "APK: $copy"
  Write-Output "SHA-256: $hash"
} finally {
  $env:JAVA_HOME = $oldJava
  $env:ANDROID_HOME = $oldAndroidHome
  $env:ANDROID_SDK_ROOT = $oldAndroidRoot
  Set-Location -LiteralPath $oldLocation
}
