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
$process = Start-Process -FilePath $Dotnet -ArgumentList @('run','-c','Release','--no-build','--project',$apiProject,'--urls',$base) -Environment $envVars -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
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
  $blockedAiEndpoint = $false
  try { $null = PutJson '/admin/ai-provider' @{enabled=$true;endpoint='https://localhost/v1/chat/completions';model='sample-model';apiKey='secret-test-key'} $adminSession } catch { $blockedAiEndpoint = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $blockedAiEndpoint) { throw 'Private AI endpoint was accepted' }
  $ai = PutJson '/admin/ai-provider' @{enabled=$true;endpoint='https://api.example.com/v1/chat/completions';model='sample-model';apiKey='secret-test-key'} $adminSession
  $aiRead = Invoke-RestMethod "$base/api/admin/ai-provider" -WebSession $adminSession
  if (-not $ai.hasApiKey -or -not $aiRead.hasApiKey -or $aiRead.PSObject.Properties.Name -contains 'apiKey' -or $aiRead.PSObject.Properties.Name -contains 'protectedApiKey') { throw 'AI key was not saved or was disclosed' }
  $null = PutJson '/admin/ai-provider' @{enabled=$false;endpoint='https://api.example.com/v1/chat/completions';model='sample-model'} $adminSession
  $plan = PostJson '/admin/plans' @{name='پایه';monthlyRial=1000000;maxUsers=3} $adminSession
  $ownerPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $tenant = PostJson '/admin/tenants' @{name='فروشگاه آزمون';slug="shop-$($id.Substring(0,8))";ownerUsername="owner_$id";ownerName='مالک آزمون';ownerPassword=$ownerPass;classicPreset=$true} $adminSession
  $null = PostJson "/admin/tenants/$($tenant.id)/subscription" @{planId=$plan.id;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');endsAt=[datetime]::UtcNow.AddDays(30).ToString('o');paymentStatus='paid'} $adminSession
  $null = PostJson '/auth/login' @{username="owner_$id";password=$ownerPass} $ownerSession $true
  $ownerAiBlocked = $false
  try { $null = Invoke-RestMethod "$base/api/admin/ai-provider" -WebSession $ownerSession } catch { $ownerAiBlocked = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $ownerAiBlocked) { throw 'Merchant could read global AI settings' }
  $advisorFallback = PostJson '/merchant/advisor/ask' @{question='وضعیت فروش چیست؟'} $ownerSession
  if ($advisorFallback.source -ne 'rules') { throw 'Disabled AI provider did not use local fallback' }
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
  $paymentBody = @{idempotencyKey="payment-1-$id";amountRial=800000;method='cash'}
  $payment = PostJson "/merchant/invoices/$($invoice.id)/payments" $paymentBody $ownerSession
  $paymentAgain = PostJson "/merchant/invoices/$($invoice.id)/payments" $paymentBody $ownerSession
  if ($paymentAgain.id -ne $payment.id) { throw 'Payment idempotency failed' }
  $detail = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $ownerSession
  if ($detail.paidRial -ne 1000000 -or $detail.paymentStatus -ne 'paid') { throw 'Payment settlement mismatch' }
  $returnLineId = $detail.lines[0].id
  $returnBody = @{idempotencyKey="return-1-$id";reason='مرجوعی آزمایشی';lines=@(@{invoiceLineId=$returnLineId;quantity=1;restock=$true})}
  $return = PostJson "/merchant/invoices/$($invoice.id)/returns" $returnBody $ownerSession
  $returnAgain = PostJson "/merchant/invoices/$($invoice.id)/returns" $returnBody $ownerSession
  if ($return.amountRial -ne 500000 -or $returnAgain.id -ne $return.id -or $return.refundDueRial -ne 500000 -or $return.paymentStatus -ne 'refund_due') { throw 'Return amount, idempotency or refund due mismatch' }
  $productsAfterReturn = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($productsAfterReturn[0].stock -ne 4) { throw 'Returned item was not restocked exactly once' }
  $overReturnBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($invoice.id)/returns" @{idempotencyKey="over-return-$id";reason='بیش از موجود';lines=@(@{invoiceLineId=$returnLineId;quantity=2;restock=$true})} $ownerSession } catch { $overReturnBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $overReturnBlocked) { throw 'Excess return was accepted' }
  $overRefundBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($invoice.id)/refunds" @{idempotencyKey="over-refund-$id";amountRial=500001;method='cash'} $ownerSession } catch { $overRefundBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $overRefundBlocked) { throw 'Excess refund was accepted' }
  $refundBody = @{idempotencyKey="refund-1-$id";amountRial=500000;method='cash';reference='LOCAL-TEST'}
  $refund = PostJson "/merchant/invoices/$($invoice.id)/refunds" $refundBody $ownerSession
  $refundAgain = PostJson "/merchant/invoices/$($invoice.id)/refunds" $refundBody $ownerSession
  if ($refund.id -ne $refundAgain.id -or $refund.paymentStatus -ne 'paid') { throw 'Refund idempotency or recalculation failed' }
  $detail = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $ownerSession
  if ($detail.returnedRial -ne 500000 -or $detail.refundedRial -ne 500000 -or $detail.lines[0].returnedQuantity -ne 1) { throw 'Return ledger/detail mismatch' }
  $returns = Invoke-RestMethod "$base/api/merchant/accounting/returns" -WebSession $ownerSession
  if (@($returns).Count -ne 1 -or $returns[0].invoiceNumber -ne 1) { throw 'Return list mismatch' }
  $financeAfterReturn = Invoke-RestMethod "$base/api/merchant/accounting/overview" -WebSession $ownerSession
  if ($financeAfterReturn.revenueRial -ne 500000 -or $financeAfterReturn.returnsRial -ne 500000 -or $financeAfterReturn.refundedRial -ne 500000 -or $financeAfterReturn.refundDueRial -ne 0) { throw 'Return accounting overview mismatch' }
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
  $autoCustomers = Invoke-RestMethod "$base/api/merchant/customers" -WebSession $otherSession
  if (@($autoCustomers).Count -ne 1 -or $autoCustomers[0].name -ne 'مشتری دوم') { throw 'New invoice customer was not added to customer list' }
  $finance = Invoke-RestMethod "$base/api/merchant/accounting/overview" -WebSession $otherSession
  if ($finance.supplierPayableRial -ne 200000 -or $finance.costOfGoodsSoldRial -ne 200000 -or $finance.estimatedOperatingRial -ne 750000) { throw 'Accounting estimate mismatch' }
  $blocked = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $otherSession } catch { $blocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $blocked) { throw 'Cross-tenant invoice read was not blocked' }
  $crossReturnBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($invoice.id)/returns" @{idempotencyKey="cross-return-$id";reason='نباید ثبت شود';lines=@(@{invoiceLineId=$returnLineId;quantity=1;restock=$true})} $otherSession } catch { $crossReturnBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossReturnBlocked) { throw 'Cross-tenant return was not blocked' }
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
  Write-Output 'PASS: login, subscription, AI key/role/endpoint/fallback, product, customer, invoice/stock/payment, return/refund/idempotency/accounting, tenant isolation, purchase/expense/cost estimate, staff role, CSRF, suspension'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Write-Output "Test log: $log"
}
