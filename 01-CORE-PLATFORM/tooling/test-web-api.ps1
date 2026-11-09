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
  $png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iX1sAAAAASUVORK5CYII='
  $photoSaved = PutJson "/merchant/products/$($product.id)/photo" @{dataUrl=$png} $ownerSession
  $photoResponse = Invoke-WebRequest "$base/api/merchant/products/$($product.id)/photo" -WebSession $ownerSession
  if (-not $photoSaved.hasPhoto -or $photoResponse.Headers['Content-Type'] -notlike 'image/png*' -or $photoResponse.RawContentLength -lt 50) { throw 'Product photo save/read failed' }
  $customer = PostJson '/merchant/customers' @{name='مشتری آزمون';phone='09120000000'} $ownerSession
  $invoiceBody = @{idempotencyKey="invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='partial';paidRial=200000;lines=@(@{productId=$product.id;quantity=2})}
  $invoice = PostJson '/merchant/invoices' $invoiceBody $ownerSession
  if ($invoice.number -ne 1 -or $invoice.totalRial -ne 1000000) { throw 'Invoice total/number mismatch' }
  $again = PostJson '/merchant/invoices' $invoiceBody $ownerSession
  if ($again.id -ne $invoice.id) { throw 'Idempotency failed' }
  $products = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($products[0].stock -ne 3) { throw 'Stock was deducted more than once or not at all' }
  $proforma = PostJson '/merchant/invoices' @{idempotencyKey="proforma-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;lines=@(@{productId=$product.id;quantity=99})} $ownerSession
  $insufficientConversionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($proforma.id)/convert" @{} $ownerSession } catch { $insufficientConversionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $insufficientConversionBlocked) { throw 'Proforma conversion ignored current stock' }
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
  $issuedRevision = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)/revisions" -WebSession $ownerSession
  if (@($issuedRevision).Count -ne 1 -or $issuedRevision[0].revisionNo -ne 1 -or ($issuedRevision[0].snapshotJson | ConvertFrom-Json).paidRial -ne 200000) { throw 'Original invoice snapshot changed after later payment' }
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
  $returnedRevisionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($invoice.id)/revisions" @{expectedRevision=1;reason='نباید مرجوعی را تغییر دهد';customerName='مشتری آزمون';customerPhone='09120000000';lines=@(@{lineId=$returnLineId;productId=$product.id;name='کیف چرم آزمون';unitPriceRial=500000;quantity=2;discountRial=0})} $ownerSession } catch { $returnedRevisionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $returnedRevisionBlocked) { throw 'Invoice with returns was revised' }
  $revisionInvoice = PostJson '/merchant/invoices' @{idempotencyKey="revision-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='unpaid';paidRial=0;lines=@(@{productId=$product.id;quantity=1})} $ownerSession
  $revisionDetail = Invoke-RestMethod "$base/api/merchant/invoices/$($revisionInvoice.id)" -WebSession $ownerSession
  $revisionLines = @(@{lineId=$revisionDetail.lines[0].id;productId=$product.id;name='کیف چرم آزمون';unitPriceRial=500000;quantity=2;discountRial=0})
  $revised = PostJson "/merchant/invoices/$($revisionInvoice.id)/revisions" @{expectedRevision=1;reason='اصلاح تعداد';customerName='مشتری اصلاح شده';customerPhone='09120000001';issuedAt='2026-11-02T12:00:00Z';lines=$revisionLines} $ownerSession
  if ($revised.revision -ne 2 -or $revised.totalRial -ne 1000000) { throw 'Invoice revision total/version mismatch' }
  $revisionHistory = Invoke-RestMethod "$base/api/merchant/invoices/$($revisionInvoice.id)/revisions" -WebSession $ownerSession
  if (@($revisionHistory).Count -ne 2 -or $revisionHistory[0].revisionNo -ne 2 -or $revisionHistory[1].revisionNo -ne 1 -or ($revisionHistory[1].snapshotJson | ConvertFrom-Json).totalRial -ne 500000) { throw 'Original invoice snapshot was not preserved' }
  $revisionAfter = Invoke-RestMethod "$base/api/merchant/invoices/$($revisionInvoice.id)" -WebSession $ownerSession
  $revisedDate = ([datetime]$revisionAfter.issuedAt).ToUniversalTime().ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  if ($revisionAfter.number -ne $revisionInvoice.number -or $revisionAfter.customerName -ne 'مشتری اصلاح شده' -or $revisionAfter.lines[0].quantity -ne 2 -or $revisedDate -ne '2026-11-02') { throw 'Revised invoice fields did not persist' }
  $staleRevisionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($revisionInvoice.id)/revisions" @{expectedRevision=1;reason='نسخه قدیمی';customerName='مشتری اصلاح شده';customerPhone='';lines=$revisionLines} $ownerSession } catch { $staleRevisionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleRevisionBlocked) { throw 'Stale invoice revision was accepted' }
  $revisionLines[0].quantity = 99
  $stockRevisionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($revisionInvoice.id)/revisions" @{expectedRevision=2;reason='موجودی ناکافی';customerName='مشتری اصلاح شده';customerPhone='';lines=$revisionLines} $ownerSession } catch { $stockRevisionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $stockRevisionBlocked) { throw 'Invoice revision ignored stock' }
  $revisionLines[0].quantity = 2
  $null = PostJson "/merchant/invoices/$($revisionInvoice.id)/payments" @{idempotencyKey="revision-payment-$id";amountRial=200000;method='cash'} $ownerSession
  $revisionLines[0].unitPriceRial = 10000
  $paidRevisionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($revisionInvoice.id)/revisions" @{expectedRevision=2;reason='کمتر از دریافتی';customerName='مشتری اصلاح شده';customerPhone='';lines=$revisionLines} $ownerSession } catch { $paidRevisionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $paidRevisionBlocked) { throw 'Invoice revision allowed total below received cash' }
  $revisionLines[0].unitPriceRial = 500000
  $stockAfterRevision = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($stockAfterRevision[0].stock -ne 2) { throw 'Invoice revision changed stock during a rejected edit' }
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
  $null = PostJson '/merchant/customers' @{name='=DANGEROUS(1)';phone='09125550000'} $ownerSession
  $csv = Invoke-WebRequest "$base/api/merchant/customers/export.csv" -WebSession $ownerSession
  if ($csv.Content -notmatch "'=DANGEROUS" -or $csv.Content -notmatch 'مشتری آزمون' -or $csv.Content -match 'مشتری دوم') { throw 'Customer CSV escaping or tenant isolation failed' }
  $crossPhotoBlocked = $false
  try { $null = Invoke-WebRequest "$base/api/merchant/products/$($product.id)/photo" -WebSession $otherSession } catch { $crossPhotoBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossPhotoBlocked) { throw 'Cross-tenant product photo read was not blocked' }
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
  $crossRevisionBlocked = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)/revisions" -WebSession $otherSession } catch { $crossRevisionBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossRevisionBlocked) { throw 'Cross-tenant invoice revision history was readable' }
  $crossReturnBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($invoice.id)/returns" @{idempotencyKey="cross-return-$id";reason='نباید ثبت شود';lines=@(@{invoiceLineId=$returnLineId;quantity=1;restock=$true})} $otherSession } catch { $crossReturnBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossReturnBlocked) { throw 'Cross-tenant return was not blocked' }
  $staffPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $staff = PostJson '/merchant/staff' @{username="staff_$id";displayName='فروشنده';password=$staffPass;role='staff'} $ownerSession
  $staffSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $null = PostJson '/auth/login' @{username="staff_$id";password=$staffPass} $staffSession $true
  $staffInvoice = PostJson '/merchant/invoices' @{idempotencyKey="staff-invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='paid';paidRial=500000;lines=@(@{productId=$product.id;quantity=1})} $staffSession
  if ($staffInvoice.totalRial -ne 500000) { throw 'Staff sale failed' }
  $priceBody = @{idempotencyKey="price-$id";percent=12.5;allProducts=$false;productIds=@($product.id)}
  $priceBatch = PostJson '/merchant/price-batches' $priceBody $ownerSession
  $priceAgain = PostJson '/merchant/price-batches' $priceBody $ownerSession
  $priced = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($priceAgain.id -ne $priceBatch.id -or $priced[0].priceRial -ne 562500) { throw 'Price batch calculation or idempotency failed' }
  $priceLines = Invoke-RestMethod "$base/api/merchant/price-batches/$($priceBatch.id)/lines" -WebSession $ownerSession
  if (@($priceLines).Count -ne 1 -or $priceLines[0].oldPriceRial -ne 500000 -or $priceLines[0].newPriceRial -ne 562500) { throw 'Price history detail mismatch' }
  $staleQuoteBlocked = $false
  try { $null = PostJson '/merchant/invoices' @{idempotencyKey="stale-quote-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;expectedTotalRial=500000;lines=@(@{productId=$product.id;quantity=1;expectedUnitPriceRial=500000})} $ownerSession } catch { $staleQuoteBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleQuoteBlocked) { throw 'Stale sale quote was accepted after price change' }
  $issuedDetail = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $ownerSession
  if ($issuedDetail.lines[0].unitPriceRial -ne 500000) { throw 'Past invoice price snapshot changed' }
  $crossPriceBlocked = $false
  try { $null = PostJson "/merchant/price-batches/$($priceBatch.id)/revert" @{} $otherSession } catch { $crossPriceBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossPriceBlocked) { throw 'Cross-tenant price batch revert was not blocked' }
  $staffPriceBlocked = $false
  try { $null = PostJson '/merchant/price-batches' @{idempotencyKey="staff-price-$id";percent=10;allProducts=$true;productIds=@()} $staffSession } catch { $staffPriceBlocked = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $staffPriceBlocked) { throw 'Staff could change prices' }
  $null = PutJson "/merchant/products/$($product.id)" @{name=$product.name;sku=$product.sku;category=$product.category;priceRial=600000;stock=3} $ownerSession
  $stalePriceBlocked = $false
  try { $null = PostJson "/merchant/price-batches/$($priceBatch.id)/revert" @{} $ownerSession } catch { $stalePriceBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $stalePriceBlocked) { throw 'Price revert overwrote a newer manual price' }
  $null = PutJson "/merchant/products/$($product.id)" @{name=$product.name;sku=$product.sku;category=$product.category;priceRial=562500;stock=3} $ownerSession
  $null = PostJson "/merchant/price-batches/$($priceBatch.id)/revert" @{} $ownerSession
  $restored = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($restored[0].priceRial -ne 500000) { throw 'Price batch revert failed' }
  $allPrice = PostJson '/merchant/price-batches' @{idempotencyKey="all-price-$id";percent=0.1;allProducts=$true;productIds=@()} $ownerSession
  $allPriced = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  if ($allPriced[0].priceRial -ne 500500) { throw 'All-products price change failed' }
  $null = PostJson "/merchant/price-batches/$($allPrice.id)/revert" @{} $ownerSession
  $null = PostJson "/merchant/archive/invoices/$($proforma.id)" @{} $ownerSession
  $archiveInvoices = Invoke-RestMethod "$base/api/merchant/archive/invoices" -WebSession $ownerSession
  if (@($archiveInvoices).Count -ne 1 -or $archiveInvoices[0].id -ne $proforma.id) { throw 'Invoice archive listing failed' }
  $null = PostJson "/merchant/archive/invoices/$($proforma.id)/restore" @{} $ownerSession
  $unpaidArchiveBlocked = $false
  $unpaidInvoice = PostJson '/merchant/invoices' @{idempotencyKey="unpaid-archive-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='unpaid';paidRial=0;lines=@(@{productId=$product.id;quantity=1})} $ownerSession
  try { $null = PostJson "/merchant/archive/invoices/$($unpaidInvoice.id)" @{} $ownerSession } catch { $unpaidArchiveBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $unpaidArchiveBlocked) { throw 'Unpaid invoice could be hidden in archive' }
  $null = PostJson "/merchant/archive/products/$($product.id)" @{} $ownerSession
  $archiveProducts = Invoke-RestMethod "$base/api/merchant/archive/products" -WebSession $ownerSession
  if (@($archiveProducts).Count -ne 1) { throw 'Product archive failed' }
  $null = PostJson "/merchant/archive/products/$($product.id)/restore" @{} $ownerSession
  $null = PostJson "/merchant/archive/customers/$($customer.id)" @{} $ownerSession
  $archiveCustomers = Invoke-RestMethod "$base/api/merchant/archive/customers" -WebSession $ownerSession
  if (@($archiveCustomers).Count -ne 1) { throw 'Customer archive failed' }
  $null = PostJson "/merchant/archive/customers/$($customer.id)/restore" @{} $ownerSession
  $discountProduct = PostJson '/merchant/products' @{name='کالای تخفیف آزمون';sku="DISCOUNT-$id";category='آزمون';priceRial=1001;stock=3} $ownerSession
  $discountBody = @{idempotencyKey="discount-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='paid';paidRial=2002;expectedTotalRial=2002;lines=@(@{productId=$discountProduct.id;quantity=3;expectedUnitPriceRial=1001;discountPercent=33.333})}
  $discountInvoice = PostJson '/merchant/invoices' $discountBody $ownerSession
  $discountDetail = Invoke-RestMethod "$base/api/merchant/invoices/$($discountInvoice.id)" -WebSession $ownerSession
  if ($discountInvoice.totalRial -ne 2002 -or $discountDetail.lines[0].unitPriceRial -ne 1001 -or $discountDetail.lines[0].totalRial -ne 2002) { throw 'Selective discount amount or immutable line snapshot mismatch' }
  $discountAgain = PostJson '/merchant/invoices' $discountBody $ownerSession
  if ($discountAgain.id -ne $discountInvoice.id) { throw 'Discounted invoice idempotency failed' }
  $discountReturn1 = PostJson "/merchant/invoices/$($discountInvoice.id)/returns" @{idempotencyKey="discount-return-1-$id";reason='آزمون مرجوعی تخفیف';lines=@(@{invoiceLineId=$discountDetail.lines[0].id;quantity=1;restock=$true})} $ownerSession
  $discountReturn2 = PostJson "/merchant/invoices/$($discountInvoice.id)/returns" @{idempotencyKey="discount-return-2-$id";reason='تکمیل مرجوعی تخفیف';lines=@(@{invoiceLineId=$discountDetail.lines[0].id;quantity=2;restock=$true})} $ownerSession
  if ($discountReturn1.amountRial -ne 667 -or $discountReturn2.amountRial -ne 1335 -or ($discountReturn1.amountRial + $discountReturn2.amountRial) -ne 2002) { throw 'Discounted partial returns did not sum to the paid net amount' }
  $discountAfterReturns = Invoke-RestMethod "$base/api/merchant/invoices/$($discountInvoice.id)" -WebSession $ownerSession
  if ($discountAfterReturns.returnedRial -ne 2002 -or $discountAfterReturns.lines[0].returnedQuantity -ne 3) { throw 'Discounted return ledger mismatch' }
  $convertible = PostJson '/merchant/invoices' @{idempotencyKey="convertible-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;lines=@(@{productId=$discountProduct.id;quantity=2;discountPercent=10})} $ownerSession
  $beforeConversion = Invoke-RestMethod "$base/api/merchant/products?q=کالای تخفیف آزمون" -WebSession $ownerSession
  $converted = PostJson "/merchant/invoices/$($convertible.id)/convert" @{} $ownerSession
  $afterConversion = Invoke-RestMethod "$base/api/merchant/products?q=کالای تخفیف آزمون" -WebSession $ownerSession
  if ($beforeConversion[0].stock -ne 3 -or $afterConversion[0].stock -ne 1 -or $converted.paymentStatus -ne 'unpaid' -or $converted.totalRial -ne 1802 -or $converted.number -ne $convertible.number) { throw 'Proforma conversion stock, price or identity mismatch' }
  $conversionHistory = Invoke-RestMethod "$base/api/merchant/invoices/$($convertible.id)/revisions" -WebSession $ownerSession
  if ($converted.revision -ne 2 -or @($conversionHistory).Count -ne 2 -or ($conversionHistory[1].snapshotJson | ConvertFrom-Json).paymentStatus -ne 'proforma' -or ($conversionHistory[0].snapshotJson | ConvertFrom-Json).paymentStatus -ne 'unpaid') { throw 'Proforma conversion history mismatch' }
  $secondConversionBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($convertible.id)/convert" @{} $ownerSession } catch { $secondConversionBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $secondConversionBlocked) { throw 'Proforma was converted twice' }
  $manualBody = @{idempotencyKey="manual-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='paid';paidRial=1752;expectedTotalRial=1752;lines=@(@{productId=$null;name='قلم آزاد آزمون';unitPriceRial=1001;quantity=2;discountPercent=12.5})}
  $manualInvoice = PostJson '/merchant/invoices' $manualBody $ownerSession
  $manualDetail = Invoke-RestMethod "$base/api/merchant/invoices/$($manualInvoice.id)" -WebSession $ownerSession
  if ($manualDetail.totalRial -ne 1752 -or $manualDetail.lines[0].productId -ne $null -or $manualDetail.lines[0].nameSnapshot -ne 'قلم آزاد آزمون' -or $manualDetail.lines[0].totalRial -ne 1752) { throw 'Manual invoice line amount or snapshot mismatch' }
  $manualReturn = PostJson "/merchant/invoices/$($manualInvoice.id)/returns" @{idempotencyKey="manual-return-$id";reason='مرجوعی قلم آزاد';lines=@(@{invoiceLineId=$manualDetail.lines[0].id;quantity=1;restock=$false})} $ownerSession
  if ($manualReturn.amountRial -ne 876) { throw 'Manual discounted line return amount mismatch' }
  $manualRestockBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($manualInvoice.id)/returns" @{idempotencyKey="manual-restock-$id";reason='نباید به انبار برگردد';lines=@(@{invoiceLineId=$manualDetail.lines[0].id;quantity=1;restock=$true})} $ownerSession } catch { $manualRestockBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $manualRestockBlocked) { throw 'Manual line was allowed to restock' }
  $manualProforma = PostJson '/merchant/invoices' @{idempotencyKey="manual-proforma-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;lines=@(@{productId=$null;name='خدمت آزاد';unitPriceRial=1000;quantity=1})} $ownerSession
  $manualConverted = PostJson "/merchant/invoices/$($manualProforma.id)/convert" @{} $ownerSession
  if ($manualConverted.paymentStatus -ne 'unpaid' -or $manualConverted.totalRial -ne 1000) { throw 'Manual-only proforma conversion failed' }
  $invalidDiscountBlocked = $false
  try { $null = PostJson '/merchant/invoices' @{idempotencyKey="invalid-discount-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;lines=@(@{productId=$discountProduct.id;quantity=1;discountPercent=101})} $ownerSession } catch { $invalidDiscountBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $invalidDiscountBlocked) { throw 'Discount over 100 percent was accepted' }
  $staleDiscountTotalBlocked = $false
  try { $null = PostJson '/merchant/invoices' @{idempotencyKey="stale-discount-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='proforma';paidRial=0;expectedTotalRial=1001;lines=@(@{productId=$discountProduct.id;quantity=1;discountPercent=10})} $ownerSession } catch { $staleDiscountTotalBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleDiscountTotalBlocked) { throw 'Stale discounted invoice total was accepted' }
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
  Write-Output 'PASS: login, subscription, AI fallback, product/photo, customer/CSV, invoice revision/history/stock/payment guard/isolation, price-quote/selective discount/manual lines/proforma conversion, returns/refund/idempotency/accounting, price batch/revert/isolation, archive/restore/open balance guard, purchase/expense/cost estimate, staff role, CSRF, suspension'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Write-Output "Test log: $log"
}
