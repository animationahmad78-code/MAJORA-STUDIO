param([string]$Dotnet = "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe")
$ErrorActionPreference = 'Stop'
$apiProject = Join-Path $PSScriptRoot '..\apps\web-api\Majora.WebApi.csproj'
$id = [guid]::NewGuid().ToString('N')
$port = 5189
$base = "http://127.0.0.1:$port"
$database = Join-Path $env:TEMP "majora-api-test-$id.db"
$log = Join-Path $env:TEMP "majora-api-test-$id.log"
$adminUser = "admin_$id"
$adminPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
$envVars = @{
  ASPNETCORE_ENVIRONMENT = 'Development'
  MAJORA_BOOTSTRAP_USER = $adminUser
  MAJORA_BOOTSTRAP_PASSWORD = $adminPass
  ConnectionStrings__Sqlite = "Data Source=$database"
}
$process = Start-Process -FilePath $Dotnet -ArgumentList @('run','--no-build','--project',$apiProject,'--urls',$base) -Environment $envVars -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $ready = $false
  for ($attempt=0; $attempt -lt 35; $attempt++) {
    try { $health = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; if ($health.status -eq 'ok') { $ready=$true; break } } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw "API did not start. See $log" }
  $adminSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $ownerSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $otherSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  function PostJson($path,$body,$session,[bool]$login=$false) {
    $headers = @{}
    if (-not $login) { $token = $session.Cookies.GetCookies([uri]$base)['majora.csrf'].Value; $headers['X-CSRF']=$token }
    Invoke-RestMethod "$base/api$path" -Method Post -WebSession $session -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  function PutJson($path,$body,$session) {
    $token = $session.Cookies.GetCookies([uri]$base)['majora.csrf'].Value
    Invoke-RestMethod "$base/api$path" -Method Put -WebSession $session -Headers @{'X-CSRF'=$token} -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  $null = PostJson '/auth/login' @{username=$adminUser;password=$adminPass} $adminSession $true
  $plan = PostJson '/admin/plans' @{name='پایه';monthlyRial=1000000;maxUsers=3} $adminSession
  $ownerPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $tenant = PostJson '/admin/tenants' @{name='فروشگاه آزمون';slug="shop-$($id.Substring(0,8))";ownerUsername="owner_$id";ownerName='مالک آزمون';ownerPassword=$ownerPass;classicPreset=$true} $adminSession
  $null = PostJson "/admin/tenants/$($tenant.id)/subscription" @{planId=$plan.id;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');endsAt=[datetime]::UtcNow.AddDays(30).ToString('o');paymentStatus='paid'} $adminSession
  $null = PostJson '/auth/login' @{username="owner_$id";password=$ownerPass} $ownerSession $true
  $brand = Invoke-RestMethod "$base/api/merchant/invoice-brand" -WebSession $ownerSession
  if ($brand.storeName -ne 'کیف و کمربند کلاسیک' -or @($brand.conditions).Count -ne 6 -or -not $brand.logoDataUrl.StartsWith('data:image/png;base64,')) { throw 'Classic invoice brand preset missing' }
  $brand.slogan = 'نسخهٔ اول آزمون'
  $brand = PutJson '/merchant/invoice-brand' $brand $ownerSession
  $product = PostJson '/merchant/products' @{name='کیف چرم آزمون';sku="BAG-$id";category='کیف';priceRial=500000;stock=5} $ownerSession
  $customer = PostJson '/merchant/customers' @{name='مشتری آزمون';phone='09120000000'} $ownerSession
  $invoiceBody = @{idempotencyKey="invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='partial';paidRial=200000;lines=@(@{productId=$product.id;quantity=2})}
  $invoice = PostJson '/merchant/invoices' $invoiceBody $ownerSession
  if ($invoice.number -ne 1 -or $invoice.totalRial -ne 1000000) { throw 'Invoice total/number mismatch' }
  $again = PostJson '/merchant/invoices' $invoiceBody $ownerSession
  if ($again.id -ne $invoice.id) { throw 'Idempotency failed' }
  $products = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($products[0].stock -ne 3) { throw 'Stock was deducted more than once or not at all' }
  $null = PostJson '/merchant/invoices' @{idempotencyKey="proforma-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;lines=@(@{productId=$product.id;quantity=99})} $ownerSession
  $dashboard = Invoke-RestMethod "$base/api/merchant/dashboard" -WebSession $ownerSession
  if ($dashboard.sales30Rial -ne 1000000 -or $dashboard.invoiceCount30 -ne 1) { throw 'Proforma was counted as realized sale' }
  $overstockBlocked = $false
  try { $null = PostJson '/merchant/invoices' @{idempotencyKey="overstock-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='unpaid';paidRial=0;lines=@(@{productId=$product.id;quantity=99})} $ownerSession } catch { $overstockBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $overstockBlocked) { throw 'Overstock sale was not blocked' }
  $null = PostJson "/merchant/invoices/$($invoice.id)/payments" @{amountRial=800000;method='cash'} $ownerSession
  $detail = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $ownerSession
  if ($detail.paidRial -ne 1000000 -or $detail.paymentStatus -ne 'paid') { throw 'Payment settlement mismatch' }
  $brand.slogan = 'نسخهٔ دوم آزمون'
  $brand = PutJson '/merchant/invoice-brand' $brand $ownerSession
  $snapshot = $detail.brandSnapshotJson | ConvertFrom-Json
  if ($snapshot.slogan -ne 'نسخهٔ اول آزمون' -or $brand.slogan -ne 'نسخهٔ دوم آزمون') { throw 'Issued invoice brand snapshot changed' }
  $staleBrandBlocked = $false
  try { $null = PutJson '/merchant/invoice-brand' @{revision=1;storeName='ناسازگار';slogan='';phone='';address='';card='';cardHolder='';note='';conditions=@();socialTelegram='';socialInstagram='';socialContact=''} $ownerSession } catch { $staleBrandBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleBrandBlocked) { throw 'Stale invoice brand edit was accepted' }
  $otherPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $other = PostJson '/admin/tenants' @{name='فروشگاه دوم';slug="other-$($id.Substring(0,8))";ownerUsername="other_$id";ownerName='مالک دوم';ownerPassword=$otherPass} $adminSession
  $null = PostJson "/admin/tenants/$($other.id)/subscription" @{planId=$plan.id;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');endsAt=[datetime]::UtcNow.AddDays(30).ToString('o');paymentStatus='paid'} $adminSession
  $null = PostJson '/auth/login' @{username="other_$id";password=$otherPass} $otherSession $true
  $otherProducts = Invoke-RestMethod "$base/api/merchant/products" -WebSession $otherSession
  if (@($otherProducts).Count -ne 0) { throw 'Tenant data leaked' }
  $otherProduct = PostJson '/merchant/products' @{name='کیف بهای تمام‌شده';sku="COST-$id";category='کیف';priceRial=500000;stock=0} $otherSession
  $purchaseBody = @{idempotencyKey="purchase-$id";supplierName='تأمین‌کننده آزمون';supplierInvoiceNumber='SUP-1';paidRial=300000;lines=@(@{productId=$otherProduct.id;quantity=5;unitCostRial=100000})}
  $purchase = PostJson '/merchant/accounting/purchases' $purchaseBody $otherSession
  $purchaseAgain = PostJson '/merchant/accounting/purchases' $purchaseBody $otherSession
  if ($purchase.totalRial -ne 500000 -or $purchaseAgain.id -ne $purchase.id) { throw 'Purchase or idempotency mismatch' }
  $null = PostJson '/merchant/accounting/expenses' @{category='اجاره';description='آزمون';amountRial=50000} $otherSession
  $null = PostJson '/merchant/invoices' @{idempotencyKey="cost-sale-$id";customerName='مشتری دوم';customerPhone='';paymentStatus='paid';paidRial=1000000;lines=@(@{productId=$otherProduct.id;quantity=2})} $otherSession
  $finance = Invoke-RestMethod "$base/api/merchant/accounting/overview" -WebSession $otherSession
  if ($finance.supplierPayableRial -ne 200000 -or $finance.costOfGoodsSoldRial -ne 200000 -or $finance.estimatedOperatingRial -ne 750000) { throw 'Accounting estimate mismatch' }
  $blocked = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $otherSession } catch { $blocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $blocked) { throw 'Cross-tenant invoice read was not blocked' }
  $staffPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $staff = PostJson '/merchant/staff' @{username="staff_$id";displayName='فروشنده';password=$staffPass;role='staff'} $ownerSession
  $staffSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $null = PostJson '/auth/login' @{username="staff_$id";password=$staffPass} $staffSession $true
  $staffInvoice = PostJson '/merchant/invoices' @{idempotencyKey="staff-invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='paid';paidRial=500000;lines=@(@{productId=$product.id;quantity=1})} $staffSession
  if ($staffInvoice.totalRial -ne 500000) { throw 'Staff sale failed' }
  $staffProductBlocked = $false
  try { $null = PostJson '/merchant/products' @{name='نباید ثبت شود';sku="DENIED-$id";category='';priceRial=1;stock=1} $staffSession } catch { $staffProductBlocked = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $staffProductBlocked) { throw 'Staff could edit catalog' }
  $csrfBlocked = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/customers" -Method Post -WebSession $ownerSession -Headers @{'X-CSRF'='invalid'} -ContentType 'application/json' -Body '{"name":"CSRF","phone":""}' } catch { $csrfBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $csrfBlocked) { throw 'CSRF protection failed' }
  $null = PutJson "/admin/tenants/$($tenant.id)" @{name='فروشگاه آزمون';enabled=$false;brandColor='#0B2B53'} $adminSession
  $suspended = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession } catch { $suspended = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $suspended) { throw 'Suspended tenant still has access' }
  Write-Output 'PASS: login, subscription, product, customer, invoice/idempotency/stock/payment, tenant isolation, purchase/expense/cost estimate, staff role, CSRF, suspension'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Write-Output "Test log: $log"
}
