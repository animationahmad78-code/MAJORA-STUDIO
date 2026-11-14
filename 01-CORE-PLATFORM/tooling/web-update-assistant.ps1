# Run on Windows with PowerShell 7: pwsh -File web-update-assistant.ps1
# This assistant validates and stages a release. It never changes the live site or database.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$form = [Windows.Forms.Form]::new()
$form.Text = 'دستیار به‌روزرسانی وب ماژورا'
$form.Size = [Drawing.Size]::new(760, 455)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.RightToLeft = 'Yes'
$form.RightToLeftLayout = $true
$form.Font = [Drawing.Font]::new('Segoe UI', 10)

function New-Label($text, $y) {
  $label = [Windows.Forms.Label]::new()
  $label.Text = $text; $label.Location = [Drawing.Point]::new(25, $y)
  $label.Size = [Drawing.Size]::new(700, 25)
  $form.Controls.Add($label)
  return $label
}
function New-TextBox($y) {
  $box = [Windows.Forms.TextBox]::new()
  $box.Location = [Drawing.Point]::new(125, $y)
  $box.Size = [Drawing.Size]::new(595, 30)
  $box.ReadOnly = $true
  $form.Controls.Add($box)
  return $box
}
function New-Button($text, $y) {
  $button = [Windows.Forms.Button]::new()
  $button.Text = $text; $button.Location = [Drawing.Point]::new(25, $y)
  $button.Size = [Drawing.Size]::new(95, 31)
  $form.Controls.Add($button)
  return $button
}
function Show-Failure($message) {
  [void][Windows.Forms.MessageBox]::Show($message, 'خطا در آماده‌سازی', 'OK', 'Error')
}

[void](New-Label '۱. فایل مشخصات نسخه را انتخاب کنید (MAJORA-web-release-....json).' 20)
$manifestBox = New-TextBox 52
$manifestButton = New-Button 'انتخاب فایل' 50
$manifestButton.Add_Click({
  $dialog = [Windows.Forms.OpenFileDialog]::new()
  $dialog.Filter = 'مشخصات نسخه ماژورا (*.json)|*.json'
  if ($dialog.ShowDialog() -eq 'OK') { $manifestBox.Text = $dialog.FileName }
})

[void](New-Label '۲. فایل ZIP همان نسخه را انتخاب کنید؛ هش آن با مشخصات نسخه بررسی می‌شود.' 100)
$packageBox = New-TextBox 132
$packageButton = New-Button 'انتخاب ZIP' 130
$packageButton.Add_Click({
  $dialog = [Windows.Forms.OpenFileDialog]::new()
  $dialog.Filter = 'بسته ماژورا (*.zip)|*.zip'
  if ($dialog.ShowDialog() -eq 'OK') { $packageBox.Text = $dialog.FileName }
})

[void](New-Label '۳. پوشه‌ای برای نگهداری نسخه‌های برنامه انتخاب کنید؛ داده‌ها و کلیدها باید بیرون از آن باشند.' 180)
$folderBox = New-TextBox 212
$folderButton = New-Button 'انتخاب پوشه' 210
$folderButton.Add_Click({
  $dialog = [Windows.Forms.FolderBrowserDialog]::new()
  if ($dialog.ShowDialog() -eq 'OK') { $folderBox.Text = $dialog.SelectedPath }
})

$status = [Windows.Forms.Label]::new()
$status.Text = 'این ابزار فقط بسته را بررسی و کنار نسخهٔ قبلی آماده می‌کند؛ سایت و پایگاه‌داده زنده را تغییر نمی‌دهد.'
$status.Location = [Drawing.Point]::new(25, 270)
$status.Size = [Drawing.Size]::new(700, 65)
$form.Controls.Add($status)

$stageButton = [Windows.Forms.Button]::new()
$stageButton.Text = 'بررسی و آماده‌سازی نسخه'
$stageButton.Location = [Drawing.Point]::new(25, 350)
$stageButton.Size = [Drawing.Size]::new(695, 37)
$stageButton.BackColor = [Drawing.Color]::FromArgb(20, 87, 158)
$stageButton.ForeColor = [Drawing.Color]::White
$form.Controls.Add($stageButton)
$stageButton.Add_Click({
  $stageButton.Enabled = $false
  try {
    if (-not (Test-Path -LiteralPath $manifestBox.Text -PathType Leaf) -or
        -not (Test-Path -LiteralPath $packageBox.Text -PathType Leaf) -or
        -not (Test-Path -LiteralPath $folderBox.Text -PathType Container)) {
      throw 'هر سه مورد را انتخاب کنید: مشخصات نسخه، بستهٔ ZIP و پوشهٔ نسخه‌ها.'
    }
    $manifest = Get-Content -LiteralPath $manifestBox.Text -Raw | ConvertFrom-Json
    if ($manifest.format -ne 1 -or $manifest.sourceHadUncommittedChanges) { throw 'این فایل مشخصات، نسخهٔ ثبت‌شده و قابل تحویل نیست.' }
    $packageName = [IO.Path]::GetFileName($packageBox.Text)
    $match = @($manifest.packages | Where-Object { $_.file -eq $packageName })
    if ($match.Count -ne 1) { throw 'فایل ZIP انتخاب‌شده با مشخصات این نسخه مطابقت ندارد.' }
    $result = & (Join-Path $PSScriptRoot 'stage-web-update.ps1') -PackageZip $packageBox.Text -ExpectedSha256 $match[0].sha256 -ReleaseRoot $folderBox.Text
    $status.Text = "نسخه آماده شد: $($result[0])`r`nبرای فعال‌سازی، راهنمای استقرار و پشتیبان‌گیری پایگاه‌داده را دنبال کنید."
    [void][Windows.Forms.MessageBox]::Show($status.Text, 'آماده‌سازی موفق', 'OK', 'Information')
  } catch { Show-Failure $_.Exception.Message }
  finally { $stageButton.Enabled = $true }
})
[void]$form.ShowDialog()
