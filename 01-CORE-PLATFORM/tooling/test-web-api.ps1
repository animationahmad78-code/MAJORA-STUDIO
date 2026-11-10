param([string]$Dotnet = "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe", [string]$ApiDll = '')
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
$arguments = if ($ApiDll) { @($ApiDll, '--urls', $base) } else { @('run','-c','Release','--no-build','--project',$apiProject,'--urls',$base) }
$process = Start-Process -FilePath $Dotnet -ArgumentList $arguments -WorkingDirectory (Split-Path $apiProject) -Environment $envVars -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
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
    if (-not $login) { $cookieName = if ($path.StartsWith('/admin/')) { 'majora.admin.csrf' } else { 'majora.csrf' }; $token = $session.Cookies.GetCookies([uri]$base)[$cookieName].Value; $headers['X-CSRF']=$token }
    Invoke-RestMethod "$base/api$path" -Method Post -WebSession $session -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  function PutJson($path,$body,$session) {
    $cookieName = if ($path.StartsWith('/admin/')) { 'majora.admin.csrf' } else { 'majora.csrf' }
    $token = $session.Cookies.GetCookies([uri]$base)[$cookieName].Value
    Invoke-RestMethod "$base/api$path" -Method Put -WebSession $session -Headers @{'X-CSRF'=$token} -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  $null = PostJson '/auth/login' @{username=$adminUser;password=$adminPass} $adminSession $true
  $missingTenant = Invoke-WebRequest "$base/api/admin/tenants/$([guid]::NewGuid())/invoice-brand" -WebSession $adminSession -SkipHttpErrorCheck
  $missingError = $missingTenant.Content | ConvertFrom-Json
  if ($missingTenant.StatusCode -ne 404 -or $missingError.errorCode -ne 'not_found' -or
      [string]::IsNullOrWhiteSpace($missingError.correlationId) -or
      $missingError.correlationId -ne $missingTenant.Headers['X-Correlation-ID']) { throw 'API 404 did not include a correlated, safe error' }
  $blockedAiEndpoint = $false
  try { $null = PutJson '/admin/ai-provider' @{enabled=$true;endpoint='https://localhost/v1/chat/completions';model='sample-model';apiKey='secret-test-key'} $adminSession } catch { $blockedAiEndpoint = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $blockedAiEndpoint) { throw 'Private AI endpoint was accepted' }
  $ai = PutJson '/admin/ai-provider' @{enabled=$true;endpoint='https://api.example.com/v1/chat/completions';model='sample-model';apiKey='secret-test-key'} $adminSession
  $aiRead = Invoke-RestMethod "$base/api/admin/ai-provider" -WebSession $adminSession
  if (-not $ai.hasApiKey -or -not $aiRead.hasApiKey -or $aiRead.PSObject.Properties.Name -contains 'apiKey' -or $aiRead.PSObject.Properties.Name -contains 'protectedApiKey') { throw 'AI key was not saved or was disclosed' }
  $null = PutJson '/admin/ai-provider' @{enabled=$false;endpoint='https://api.example.com/v1/chat/completions';model='sample-model'} $adminSession
  $plan = PostJson '/admin/plans' @{name='پایه';monthlyRial=1000000;maxUsers=3} $adminSession
  $ownerPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $tenantBody = @{name='فروشگاه آزمون';slug="shop-$($id.Substring(0,8))";ownerUsername="owner_$id";ownerName='مالک آزمون';ownerPassword=$ownerPass;classicPreset=$true}
  $tenant = PostJson '/admin/tenants' $tenantBody $adminSession
  $tenantAgain = PostJson '/admin/tenants' $tenantBody $adminSession
  if ($tenantAgain.id -ne $tenant.id) { throw 'Repeated tenant creation was not idempotent' }
  $createdTenantIds = [System.Collections.Generic.HashSet[string]]::new()
  [void]$createdTenantIds.Add($tenant.id.ToString())
  for ($shopIndex = 2; $shopIndex -le 20; $shopIndex++) {
    $shop = PostJson '/admin/tenants' @{name="فروشگاه آزمون $shopIndex";slug="shop-$($id.Substring(0,8))-$shopIndex";ownerUsername="owner_$($id)_$shopIndex";ownerName="مالک $shopIndex";ownerPassword=$ownerPass;classicPreset=$false} $adminSession
    if (-not $createdTenantIds.Add($shop.id.ToString())) { throw 'Consecutive tenant creation reused an ID' }
  }
  $tenantList = Invoke-RestMethod "$base/api/admin/tenants" -WebSession $adminSession
  if (@($tenantList).Count -ne 20) { throw 'Consecutive tenant creation did not produce exactly 20 shops' }
  $duplicateRejected = $false
  try { $null = PostJson '/admin/tenants' @{name='فروشگاه دیگر';slug=$tenantBody.slug;ownerUsername='different_owner';ownerName='مالک دیگر';ownerPassword=$ownerPass;classicPreset=$false} $adminSession } catch { $duplicateRejected = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $duplicateRejected) { throw 'Conflicting repeated tenant creation was accepted' }
  $invalidOwnerNameBlocked = $false
  try { $null = PostJson '/admin/tenants' @{name='ثبت نامعتبر';slug="invalid-$($id.Substring(0,8))";ownerUsername="invalid_$id";ownerName='';ownerPassword=$ownerPass} $adminSession } catch { $invalidOwnerNameBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $invalidOwnerNameBlocked) { throw 'Invalid tenant form was not rejected cleanly' }
  $subscriptionBody = @{planId=$plan.id;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');endsAt=[datetime]::UtcNow.AddDays(30).ToString('o');paymentStatus='paid'}
  $invalidSubscriptionBlocked = $false
  try { $null = PostJson "/admin/tenants/$($tenant.id)/subscription" @{planId=$plan.id;startsAt=$subscriptionBody.endsAt;endsAt=$subscriptionBody.startsAt;paymentStatus='paid'} $adminSession } catch { $invalidSubscriptionBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $invalidSubscriptionBlocked) { throw 'Invalid subscription form was not rejected cleanly' }
  $subscription = PostJson "/admin/tenants/$($tenant.id)/subscription" $subscriptionBody $adminSession
  $subscriptionAgain = PostJson "/admin/tenants/$($tenant.id)/subscription" $subscriptionBody $adminSession
  if ($subscriptionAgain.id -ne $subscription.id) { throw 'Repeated subscription creation was not idempotent' }
  $adminOverview = Invoke-RestMethod "$base/api/admin/overview" -WebSession $adminSession
  if ($adminOverview.tenants -ne 20 -or $adminOverview.activeSubscriptions -ne 1) { throw 'Admin overview active tenant count disagrees with subscription data' }
  $null = PostJson '/auth/login' @{username="owner_$id";password=$ownerPass} $ownerSession $true
  $null = PostJson '/auth/login' @{username=$adminUser;password=$adminPass} $ownerSession $true
  $adminInSharedBrowser = Invoke-RestMethod "$base/api/auth/me?panel=admin" -WebSession $ownerSession
  $merchantInSharedBrowser = Invoke-RestMethod "$base/api/auth/me?panel=merchant" -WebSession $ownerSession
  if ($adminInSharedBrowser.role -ne 'platform_admin' -or $merchantInSharedBrowser.role -ne 'owner') { throw 'Admin and merchant cookies replaced each other' }
  $null = Invoke-RestMethod "$base/api/admin/overview" -WebSession $ownerSession
  $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  $adminToken = $ownerSession.Cookies.GetCookies([uri]$base)['majora.admin.csrf'].Value
  $null = Invoke-RestMethod "$base/api/auth/logout" -Method Post -WebSession $ownerSession -Headers @{'X-CSRF'=$adminToken;'X-Majora-Panel'='admin'}
  $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $ownerSession
  $adminStillSignedIn = $true
  try { $null = Invoke-RestMethod "$base/api/admin/overview" -WebSession $ownerSession } catch { $adminStillSignedIn = $false }
  if ($adminStillSignedIn) { throw 'Admin logout did not invalidate its cookie' }
  $ownerAiBlocked = $false
  try { $null = Invoke-RestMethod "$base/api/admin/ai-provider" -WebSession $ownerSession } catch { $ownerAiBlocked = $_.Exception.Response.StatusCode -in 401,403 }
  if (-not $ownerAiBlocked) { throw 'Merchant could read global AI settings' }
  $advisorFallback = PostJson '/merchant/advisor/ask' @{question='وضعیت فروش چیست؟'} $ownerSession
  if ($advisorFallback.source -ne 'rules') { throw 'Disabled AI provider did not use local fallback' }
  $brand = Invoke-RestMethod "$base/api/merchant/invoice-brand" -WebSession $ownerSession
  if ($brand.storeName -ne 'کیف و کمربند کلاسیک' -or @($brand.conditions).Count -ne 6 -or -not $brand.logoDataUrl.StartsWith('data:image/png;base64,')) { throw 'Classic invoice brand preset missing' }
  $brand.phone = '051-33662794 | 0910-500-3669'
  $brand.socialLinks = @(
    @{platform='telegram';text='@CLASSICBAG33662880';enabled=$true},
    @{platform='instagram';text='@CLASSIC_STORE_GALLERY';enabled=$true},
    @{platform='website';text='classic.example.ir';enabled=$true},
    @{platform='phone';text='0910-500-3669';enabled=$false}
  )
  $brand = PutJson '/merchant/invoice-brand' $brand $ownerSession
  if ($brand.phone -ne '051-33662794 | 0910-500-3669' -or @($brand.socialLinks).Count -ne 4 -or $brand.socialLinks[2].platform -ne 'website') { throw 'Merchant could not edit invoice contact details' }
  $tooManySocial = $brand | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $tooManySocial.socialLinks = @($tooManySocial.socialLinks) + @(@{platform='x';text='@example';enabled=$true})
  $socialLimitBlocked = $false
  try { $null = PutJson '/merchant/invoice-brand' $tooManySocial $ownerSession } catch { $socialLimitBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $socialLimitBlocked) { throw 'Invoice footer accepted more than four links' }
  $brand.storeName = 'نام غیرمجاز'
  $merchantBrandBlocked = $false
  try { $null = PutJson '/merchant/invoice-brand' $brand $ownerSession } catch { $merchantBrandBlocked = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $merchantBrandBlocked) { throw 'Merchant changed canonical invoice brand' }
  $brand.storeName = 'کیف و کمربند کلاسیک'
  $brand.slogan = 'نسخهٔ اول آزمون'
  $brand = PutJson "/admin/tenants/$($tenant.id)/invoice-brand" @{brand=$brand;reason='آزمون تغییر هویت'} $adminSession
  $brandRead = Invoke-RestMethod "$base/api/merchant/invoice-brand" -WebSession $ownerSession
  if ($brandRead.slogan -ne 'نسخهٔ اول آزمون' -or $brandRead.revision -ne $brand.revision) { throw 'Admin invoice brand update was not visible to merchant' }
  $brand.logoDataUrl = $null
  $logoDeletionBlocked = $false
  try { $null = PutJson "/admin/tenants/$($tenant.id)/invoice-brand" @{brand=$brand;reason='آزمون حذف'} $adminSession } catch { $logoDeletionBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $logoDeletionBlocked) { throw 'Primary logo could be deleted without replacement' }
  $brand.logoDataUrl = $brandRead.logoDataUrl
  $product = PostJson '/merchant/products' @{name='کیف چرم آزمون';sku="BAG-$id";category='کیف';priceRial=500000;stock=5} $ownerSession
  $png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iX1sAAAAASUVORK5CYII='
  $photoSaved = PutJson "/merchant/products/$($product.id)/photo" @{dataUrl=$png} $ownerSession
  $photoResponse = Invoke-WebRequest "$base/api/merchant/products/$($product.id)/photo" -WebSession $ownerSession
  if (-not $photoSaved.hasPhoto -or $photoResponse.Headers['Content-Type'] -notlike 'image/png*' -or $photoResponse.RawContentLength -lt 50) { throw 'Product photo save/read failed' }
  $customer = PostJson '/merchant/customers' @{name='مشتری آزمون';phone='09120000000';address='مشهد';occupation='فروشنده';acquisitionSource='معرفی';referrerPhone='09121111111';notes='مشتری وفادار'} $ownerSession
  $badPhoneBlocked = $false
  try { $null = PostJson '/merchant/customers' @{name='شماره اشتباه';phone='0912000000'} $ownerSession } catch { $badPhoneBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $badPhoneBlocked) { throw 'Short customer phone was accepted' }
  $persianPhoneCustomer = PutJson "/merchant/customers/$($customer.id)" @{name='مشتری آزمون';phone='۰۹۱۲-۰۰۰-۰۰۰۰';address='مشهد';occupation='فروشنده';acquisitionSource='معرفی';referrerPhone='09121111111';notes='مشتری وفادار'} $ownerSession
  if ($persianPhoneCustomer.phone -ne '09120000000') { throw 'Persian phone was not normalized' }
  if ($customer.address -ne 'مشهد' -or $customer.acquisitionSource -ne 'معرفی') { throw 'Optional customer profile was not stored' }
  $invoiceBody = @{idempotencyKey="invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='partial';paidRial=200000;lines=@(@{productId=$product.id;quantity=2})}
  $invoice = PostJson '/merchant/invoices' $invoiceBody $ownerSession
  $noCheque = Invoke-WebRequest "$base/api/merchant/invoices/$($invoice.id)/cheque" -WebSession $ownerSession
  if ($noCheque.StatusCode -ne 200 -or $noCheque.Content -ne 'null') { throw 'Non-cheque invoice returned unexpected cheque data' }
  $customerStatuses = Invoke-RestMethod "$base/api/merchant/customers/with-status" -WebSession $ownerSession
  $customerWithStatus = $customerStatuses | Where-Object id -eq $customer.id | Select-Object -First 1
  if ($customerWithStatus.status -ne 'receivable' -or $customerWithStatus.receivableRial -ne 800000) { throw 'Customer payment badge disagrees with invoice receivable' }
  $updatedCustomer = PutJson "/merchant/customers/$($customer.id)" @{name='مشتری آزمون';phone='09120000000';address='تهران';occupation='فروشنده';acquisitionSource='معرفی';referrerPhone='09121111111';notes='به‌روز'} $ownerSession
  if ($updatedCustomer.address -ne 'تهران') { throw 'Customer profile update failed' }
  $reminder = PostJson '/merchant/reminders' @{title='تماس با مشتری';dueAt=[datetime]::UtcNow.AddDays(2).ToString('o')} $ownerSession
  $editedReminder = PutJson "/merchant/reminders/$($reminder.id)" @{title='پیگیری پرداخت مشتری';dueAt=[datetime]::UtcNow.AddDays(3).ToString('o')} $ownerSession
  if ($editedReminder.title -ne 'پیگیری پرداخت مشتری') { throw 'Reminder could not be edited' }
  if ($invoice.number -ne 1 -or $invoice.totalRial -ne 1000000) { throw 'Invoice total/number mismatch' }
  $brand.storeName = 'نام جدید فروشگاه'
  $brand = PutJson "/admin/tenants/$($tenant.id)/invoice-brand" @{brand=$brand;reason='آزمون ثبات برند فاکتور قبلی'} $adminSession
  $frozenInvoice = Invoke-RestMethod "$base/api/merchant/invoices/$($invoice.id)" -WebSession $ownerSession
  if (($frozenInvoice.brandSnapshotJson | ConvertFrom-Json).storeName -ne 'کیف و کمربند کلاسیک') { throw 'Issued invoice lost its brand snapshot' }
  $workspace = Invoke-RestMethod "$base/api/merchant/workspace" -WebSession $ownerSession
  if ($workspace.name -ne 'نام جدید فروشگاه') { throw 'Workspace brand did not follow admin edit' }
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
  $dashboardAfterReturn = Invoke-RestMethod "$base/api/merchant/dashboard" -WebSession $ownerSession
  $advisorAfterReturn = Invoke-RestMethod "$base/api/merchant/advisor" -WebSession $ownerSession
  $chatAfterReturn = PostJson '/merchant/advisor/ask' @{question='فروش و مانده چقدر است؟'} $ownerSession
  if ($dashboardAfterReturn.sales30Rial -ne $financeAfterReturn.revenueRial -or
      $advisorAfterReturn.salesRial -ne $financeAfterReturn.revenueRial -or
      $chatAfterReturn.facts.salesRial -ne $financeAfterReturn.revenueRial -or
      $dashboardAfterReturn.receivable30Rial -ne $financeAfterReturn.customerReceivableRial -or
      $advisorAfterReturn.outstandingRial -ne $financeAfterReturn.customerReceivableRial -or
      $chatAfterReturn.facts.outstandingRial -ne $financeAfterReturn.customerReceivableRial) { throw 'Dashboard, accounting and advisor disagree after return/refund' }
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
  $brand = PutJson "/admin/tenants/$($tenant.id)/invoice-brand" @{brand=$brand;reason='آزمون نسخه دوم'} $adminSession
  $snapshot = $detail.brandSnapshotJson | ConvertFrom-Json
  if ($snapshot.slogan -ne 'نسخهٔ اول آزمون' -or $brand.slogan -ne 'نسخهٔ دوم آزمون') { throw 'Issued invoice brand snapshot changed' }
  $staleBrandBlocked = $false
  try { $null = PutJson "/admin/tenants/$($tenant.id)/invoice-brand" @{brand=@{revision=1;storeName='ناسازگار';slogan='';phone='';address='';card='';cardHolder='';note='';conditions=@();socialTelegram='';socialInstagram='';socialContact='';logoDataUrl=$brand.logoDataUrl};reason='آزمون نسخه منسوخ'} $adminSession } catch { $staleBrandBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleBrandBlocked) { throw 'Stale invoice brand edit was accepted' }
  $chequeDetails = @{direction='received';party='مشتری آزمون';serial='CHK-100';bank='بانک آزمون';amountRial=600000;dueAt=[datetime]::UtcNow.AddDays(5).ToString('o');sayadId='1234567890123456';issuerNationalId='';beneficiaryNationalId='';registrationStatus='unknown';note='آزمون چک';showDetails=$true;showImage=$true;photoDataUrl=$png}
  $chequeInvoiceBody = @{idempotencyKey="cheque-invoice-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='cheque';paidRial=0;lines=@(@{productId=$null;name='قلم چکی';unitPriceRial=1000000;quantity=1});cheque=$chequeDetails}
  $chequeInvoice = PostJson '/merchant/invoices' $chequeInvoiceBody $ownerSession
  $chequeForPreview = Invoke-RestMethod "$base/api/merchant/invoices/$($chequeInvoice.id)/cheque" -WebSession $ownerSession
  if ($chequeForPreview.serial -ne 'CHK-100') { throw 'Cheque details for invoice preview failed' }
  $chequeInvoiceAgain = PostJson '/merchant/invoices' $chequeInvoiceBody $ownerSession
  if ($chequeInvoiceAgain.id -ne $chequeInvoice.id) { throw 'Cheque invoice idempotency failed' }
  $chequeList = Invoke-RestMethod "$base/api/merchant/accounting/cheques" -WebSession $ownerSession
  $linkedCheque = @($chequeList | Where-Object invoiceId -eq $chequeInvoice.id)[0]
  if (-not $linkedCheque -or $linkedCheque.amountRial -ne 600000 -or $linkedCheque.status -ne 'open' -or -not $linkedCheque.hasPhoto) { throw 'Cheque invoice did not create a linked cheque record' }
  $duplicateSayadBlocked = $false
  try { $null = PostJson '/merchant/accounting/cheques' @{direction='received';party='مشتری دیگر';serial='CHK-DUP';bank='بانک آزمون';amountRial=100000;dueAt=[datetime]::UtcNow.AddDays(6).ToString('o');sayadId='1234567890123456';registrationStatus='unknown'} $ownerSession } catch { $duplicateSayadBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $duplicateSayadBlocked) { throw 'Duplicate Sayad identifier was accepted in same tenant' }
  $chequePhoto = Invoke-WebRequest "$base/api/merchant/accounting/cheques/$($linkedCheque.id)/photo" -WebSession $ownerSession
  if ($chequePhoto.Headers['Content-Type'] -notlike 'image/png*') { throw 'Cheque photo could not be read' }
  $chequePaymentBlocked = $false
  try { $null = PostJson "/merchant/invoices/$($chequeInvoice.id)/payments" @{idempotencyKey="cheque-payment-$id";amountRial=500000;method='cash'} $ownerSession } catch { $chequePaymentBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $chequePaymentBlocked) { throw 'Open cheque allowed untracked invoice payment' }
  $chequeReturnBlocked = $false
  $chequeDetail = Invoke-RestMethod "$base/api/merchant/invoices/$($chequeInvoice.id)" -WebSession $ownerSession
  try { $null = PostJson "/merchant/invoices/$($chequeInvoice.id)/returns" @{idempotencyKey="cheque-return-$id";reason='آزمون';lines=@(@{invoiceLineId=$chequeDetail.lines[0].id;quantity=1;restock=$false})} $ownerSession } catch { $chequeReturnBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $chequeReturnBlocked) { throw 'Open cheque allowed invoice return' }
  $chequeOverview = Invoke-RestMethod "$base/api/merchant/accounting/cheques/overview" -WebSession $ownerSession
  if (@($chequeOverview.groups | Where-Object { $_.status -eq 'open' -and $_.direction -eq 'received' })[0].amountRial -ne 600000) { throw 'Cheque overview mismatch' }
  $null = PostJson "/merchant/accounting/cheques/$($linkedCheque.id)/status" @{status='cleared'} $ownerSession
  $chequeSettled = Invoke-RestMethod "$base/api/merchant/invoices/$($chequeInvoice.id)" -WebSession $ownerSession
  if ($chequeSettled.paidRial -ne 600000 -or $chequeSettled.paymentStatus -ne 'partial') { throw 'Cleared cheque did not post exactly one invoice payment' }
  $doubleClearingBlocked = $false
  try { $null = PostJson "/merchant/accounting/cheques/$($linkedCheque.id)/status" @{status='cleared'} $ownerSession } catch { $doubleClearingBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $doubleClearingBlocked) { throw 'Cheque cleared twice' }
  $missingCorrectionReasonBlocked = $false
  try { $null = PostJson "/merchant/accounting/cheques/$($linkedCheque.id)/status" @{status='open'} $ownerSession } catch { $missingCorrectionReasonBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $missingCorrectionReasonBlocked) { throw 'Cheque status correction accepted without reason' }
  $null = PostJson "/merchant/accounting/cheques/$($linkedCheque.id)/status" @{status='open';reason='اصلاح ثبت اشتباه وصول'} $ownerSession
  $reopenedInvoice = Invoke-RestMethod "$base/api/merchant/invoices/$($chequeInvoice.id)" -WebSession $ownerSession
  if ($reopenedInvoice.paidRial -ne 0) { throw 'Reopening cleared cheque did not reverse invoice payment' }
  $null = PostJson "/merchant/accounting/cheques/$($linkedCheque.id)/status" @{status='cleared'} $ownerSession
  $reclearedInvoice = Invoke-RestMethod "$base/api/merchant/invoices/$($chequeInvoice.id)" -WebSession $ownerSession
  if ($reclearedInvoice.paidRial -ne 600000) { throw 'Cheque could not be cleared after correction' }
  $returnedCheque = PostJson '/merchant/invoices' @{idempotencyKey="cheque-returned-$id";customerId=$customer.id;customerName='';customerPhone='';paymentStatus='cheque';paidRial=0;lines=@(@{productId=$null;name='قلم چکی دوم';unitPriceRial=200000;quantity=1});cheque=@{direction='received';party='مشتری آزمون';serial='CHK-200';bank='بانک آزمون';amountRial=200000;dueAt=[datetime]::UtcNow.AddDays(7).ToString('o');registrationStatus='unknown'}} $ownerSession
  $allCheques = Invoke-RestMethod "$base/api/merchant/accounting/cheques" -WebSession $ownerSession
  $returnedRecord = @($allCheques | Where-Object { $_.invoiceId -eq $returnedCheque.id })[0]
  $null = PostJson "/merchant/accounting/cheques/$($returnedRecord.id)/status" @{status='returned'} $ownerSession
  $returnedInvoice = Invoke-RestMethod "$base/api/merchant/invoices/$($returnedCheque.id)" -WebSession $ownerSession
  if ($returnedInvoice.paymentStatus -ne 'unpaid' -or $returnedInvoice.paidRial -ne 0) { throw 'Returned cheque was treated as paid' }
  $independentCheque = PostJson '/merchant/accounting/cheques' @{direction='issued';party='تأمین‌کننده آزمون';serial='OUT-1';bank='بانک آزمون';amountRial=100000;dueAt=[datetime]::UtcNow.AddDays(9).ToString('o');registrationStatus='unknown'} $ownerSession
  if (-not $independentCheque.id) { throw 'Independent issued cheque was not registered' }
  $issuedOnly = Invoke-RestMethod "$base/api/merchant/accounting/cheques?direction=issued" -WebSession $ownerSession
  if (@($issuedOnly).Count -ne 1 -or $issuedOnly[0].id -ne $independentCheque.id) { throw 'Issued-cheque direction filter included received records' }
  $otherPass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $other = PostJson '/admin/tenants' @{name='فروشگاه دوم';slug="other-$($id.Substring(0,8))";ownerUsername="other_$id";ownerName='مالک دوم';ownerPassword=$otherPass} $adminSession
  $null = PostJson "/admin/tenants/$($other.id)/subscription" @{planId=$plan.id;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');endsAt=[datetime]::UtcNow.AddDays(30).ToString('o');paymentStatus='paid'} $adminSession
  $null = PostJson '/auth/login' @{username="other_$id";password=$otherPass} $otherSession $true
  $otherProducts = Invoke-RestMethod "$base/api/merchant/products" -WebSession $otherSession
  if (@($otherProducts).Count -ne 0) { throw 'Tenant data leaked' }
  $null = PostJson '/merchant/customers' @{name='=DANGEROUS(1)';phone='09125550000'} $ownerSession
  $csv = Invoke-WebRequest "$base/api/merchant/customers/export.csv" -WebSession $ownerSession
  if ($csv.Content -notmatch "'=DANGEROUS" -or $csv.Content -notmatch 'مشتری آزمون' -or $csv.Content -match 'مشتری دوم' -or $csv.Content -notmatch 'ردیف,نام و نام خانوادگی,شماره تماس') { throw 'Customer CSV escaping, columns, or tenant isolation failed' }
  $xlsxFile = Join-Path $env:TEMP "majora-customers-test-$id.xlsx"
  Invoke-WebRequest "$base/api/merchant/customers/export.xlsx" -WebSession $ownerSession -OutFile $xlsxFile
  $workbook = [System.IO.Compression.ZipFile]::OpenRead($xlsxFile)
  try {
    $sheet = $workbook.GetEntry('xl/worksheets/sheet1.xml')
    if (-not $sheet) { throw 'Customer Excel export has no worksheet' }
    $reader = [System.IO.StreamReader]::new($sheet.Open())
    try { $sheetXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $workbook.Dispose(); Remove-Item -LiteralPath $xlsxFile -Force }
  [xml]$sheetDocument = $sheetXml
  $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheetDocument.NameTable)
  $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $exportedRows = $sheetDocument.SelectNodes('//x:sheetData/x:row', $sheetNs)
  $phoneCells = $sheetDocument.SelectNodes('//x:sheetData/x:row[position()>1]/x:c[starts-with(@r,"C")]', $sheetNs)
  $badPhoneCells = @($phoneCells | Where-Object { $_.GetAttribute('t') -ne 'inlineStr' })
  if ($exportedRows.Count -ne 4 -or $sheetXml -notmatch 'rightToLeft="1"' -or $sheetXml -notmatch '۰۹۱۲|0912' -or
      $sheetXml -notmatch '=DANGEROUS\(1\)' -or $sheetXml -match 'مشتری دوم' -or
      $sheetDocument.SelectNodes('//x:f', $sheetNs).Count -gt 0 -or
      $sheetDocument.SelectSingleNode('//x:row[@r="1"]/x:c[@r="A1"]/x:is/x:t', $sheetNs).InnerText -ne 'ردیف' -or
      $sheetDocument.SelectSingleNode('//x:row[@r="2"]/x:c[@r="A2"]/x:v', $sheetNs).InnerText -ne '1' -or
      $badPhoneCells.Count -gt 0) {
    throw "Customer Excel columns, row numbers, phone text, formula safety, RTL or tenant isolation failed; rows=$($exportedRows.Count), badPhone=$($badPhoneCells.Count)"
  }
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
  $crossChequeBlocked = $false
  try { $null = Invoke-WebRequest "$base/api/merchant/accounting/cheques/$($linkedCheque.id)/photo" -WebSession $otherSession } catch { $crossChequeBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossChequeBlocked) { throw 'Cross-tenant cheque photo was readable' }
  $crossChequeStatusBlocked = $false
  try { $null = PostJson "/merchant/accounting/cheques/$($independentCheque.id)/status" @{status='cleared'} $otherSession } catch { $crossChequeStatusBlocked = $_.Exception.Response.StatusCode -eq 404 }
  if (-not $crossChequeStatusBlocked) { throw 'Cross-tenant cheque status changed' }
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
  $invoicePage = Invoke-RestMethod "$base/api/merchant/invoices?page=1" -WebSession $ownerSession
  $invoiceSearch = Invoke-RestMethod "$base/api/merchant/invoices?q=$($invoice.number)&field=number&page=1" -WebSession $ownerSession
  $emptyInvoicePage = Invoke-RestMethod "$base/api/merchant/invoices?page=2" -WebSession $ownerSession
  if (@($invoicePage | Where-Object id -eq $invoice.id).Count -ne 1 -or @($invoiceSearch).Count -ne 1 -or
      $invoiceSearch[0].id -ne $invoice.id -or @($emptyInvoicePage | Where-Object { $null -ne $_ }).Count -ne 0) {
    throw "Invoice list search or pagination failed: pageMatches=$(@($invoicePage | Where-Object id -eq $invoice.id).Count), searchCount=$(@($invoiceSearch).Count), searchId=$($invoiceSearch[0].id), expected=$($invoice.id), page2=$(@($emptyInvoicePage | Where-Object { $null -ne $_ }).Count)"
  }
  $ordinaryCheque = Invoke-WebRequest "$base/api/merchant/invoices/$($invoice.id)/cheque" -WebSession $ownerSession
  if ($ordinaryCheque.StatusCode -ne 200 -or ([string]$ordinaryCheque.Content).Trim() -ne 'null') { throw "Ordinary invoice unexpectedly has a cheque: status=$($ordinaryCheque.StatusCode), body=$($ordinaryCheque.Content)" }
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
  $beforeSuspension = (Invoke-RestMethod "$base/api/admin/overview" -WebSession $adminSession).activeSubscriptions
  $null = PutJson "/admin/tenants/$($tenant.id)" @{name='فروشگاه آزمون';enabled=$false;brandColor='#0B2B53'} $adminSession
  if ((Invoke-RestMethod "$base/api/admin/overview" -WebSession $adminSession).activeSubscriptions -ne $beforeSuspension - 1) { throw 'Suspended tenant was counted as active' }
  $suspended = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession } catch { $suspended = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $suspended) { throw 'Suspended tenant still has access' }
  $null = PutJson "/admin/tenants/$($tenant.id)" @{name='فروشگاه آزمون';enabled=$true;brandColor='#0B2B53'} $adminSession
  if ((Invoke-RestMethod "$base/api/admin/overview" -WebSession $adminSession).activeSubscriptions -ne $beforeSuspension) { throw 'Reactivated tenant was missing from active overview' }
  $reactivated = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession
  if (@($reactivated).Count -lt 1) { throw 'Reactivated tenant did not regain access' }
  $merchantSubscriptions = Invoke-RestMethod "$base/api/merchant/subscription" -WebSession $ownerSession
  if (@($merchantSubscriptions | Where-Object id -eq $subscription.id).Count -ne 1) { throw 'Admin and merchant subscription views disagree' }
  $adminUsers = Invoke-RestMethod "$base/api/admin/users" -WebSession $adminSession
  if (@($adminUsers).Count -ne (Invoke-RestMethod "$base/api/admin/overview" -WebSession $adminSession).users -or
      @($adminUsers | Where-Object username -eq "staff_$id").Count -ne 1) { throw 'Admin user list and overview disagree' }
  $staffActivity = Invoke-RestMethod "$base/api/merchant/activity" -WebSession $ownerSession
  if (@($staffActivity | Where-Object action -eq 'invoice.issue').Count -lt 1) { throw 'Owner activity history omitted invoice' }
  $searchedActivity = Invoke-RestMethod "$base/api/merchant/activity?q=invoice.issue" -WebSession $ownerSession
  if (@($searchedActivity).Count -lt 1 -or @($searchedActivity | Where-Object action -ne 'invoice.issue').Count -gt 0) { throw 'Owner activity search did not filter across history' }
  $adminActivity = Invoke-RestMethod "$base/api/admin/activity?tenantId=$($tenant.id)" -WebSession $adminSession
  if (@($adminActivity | Where-Object action -eq 'invoice.issue').Count -lt 1) { throw 'Admin activity history omitted tenant invoice' }
  $adminSearch = Invoke-RestMethod "$base/api/admin/activity?tenantId=$($tenant.id)&q=invoice.issue" -WebSession $adminSession
  if (@($adminSearch).Count -lt 1 -or @($adminSearch | Where-Object action -ne 'invoice.issue').Count -gt 0) { throw 'Admin activity search did not filter within tenant' }
  $activityDenied = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/activity" -WebSession $staffSession } catch { $activityDenied = $_.Exception.Response.StatusCode -eq 403 }
  if (-not $activityDenied) { throw 'Staff could read owner activity history' }
  $renamedStaff = "renamed_$id"
  $null = PutJson "/merchant/staff/$($staff.id)/username" @{username=$renamedStaff} $ownerSession
  $oldNameBlocked = $false
  try { $null = PostJson '/auth/login' @{username="staff_$id";password=$staffPass} ([Microsoft.PowerShell.Commands.WebRequestSession]::new()) $true } catch { $oldNameBlocked = $_.Exception.Response.StatusCode -eq 401 }
  if (-not $oldNameBlocked) { throw 'Old staff username still worked' }
  $oldStaffSessionValid = $true
  try { $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession } catch { $oldStaffSessionValid = $_.Exception.Response.StatusCode -ne 401 }
  if ($oldStaffSessionValid) { throw 'Staff rename left old session valid' }
  $null = PostJson '/auth/login' @{username=$renamedStaff;password=$staffPass} $staffSession $true
  $staffNewPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $null = PostJson "/merchant/staff/$($staff.id)/reset-password" @{newPassword=$staffNewPassword} $ownerSession
  $oldStaffSessionValid = $true
  try { $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession } catch { $oldStaffSessionValid = $_.Exception.Response.StatusCode -ne 401 }
  if ($oldStaffSessionValid) { throw 'Owner password reset left old session valid' }
  $null = PostJson '/auth/login' @{username=$renamedStaff;password=$staffNewPassword} $staffSession $true
  $null = PutJson '/admin/billing' @{cardNumber='1111222233334444';cardHolder='MAJORA TEST'} $adminSession
  $billing = Invoke-RestMethod "$base/api/merchant/billing" -WebSession $ownerSession
  if ($billing.cardNumber -ne '1111222233334444') { throw 'Merchant billing account missing' }
  $promo = PostJson '/admin/promo-codes' @{code="TEST_$($id.Substring(0,8))";percent=10;startsAt=[datetime]::UtcNow.AddDays(-1).ToString('o');expiresAt=[datetime]::UtcNow.AddDays(7).ToString('o');enabled=$true} $adminSession
  $quote = Invoke-RestMethod "$base/api/merchant/subscription/quote?planId=$($plan.id)&code=$($promo.code)" -WebSession $ownerSession
  if ($quote.basePriceRial -ne 1000000 -or $quote.totalRial -ne 900000 -or $quote.discountPercent -ne 10) { throw 'Promo quote calculation mismatch' }
  $invalidPromoBlocked = $false
  try { $null = Invoke-RestMethod "$base/api/merchant/subscription/quote?planId=$($plan.id)&code=INVALID" -WebSession $ownerSession } catch { $invalidPromoBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $invalidPromoBlocked) { throw 'Invalid promo code was accepted' }
  $staleOrderBlocked = $false
  try { $null = PostJson '/merchant/subscription/orders' @{planId=$plan.id;idempotencyKey="stale-order-$id";promoCode=$promo.code;receiptDataUrl=$png;expectedTotalRial=1000000} $ownerSession } catch { $staleOrderBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleOrderBlocked) { throw 'Subscription order accepted an outdated quoted amount' }
  $orderBody = @{planId=$plan.id;idempotencyKey="order-$id";promoCode=$promo.code;receiptDataUrl=$png;expectedTotalRial=900000}
  $order = PostJson '/merchant/subscription/orders' $orderBody $ownerSession
  $orderAgain = PostJson '/merchant/subscription/orders' $orderBody $ownerSession
  if ($orderAgain.id -ne $order.id -or $order.totalRial -ne 900000) { throw 'Subscription order idempotency or price failed' }
  $pendingOrders = Invoke-RestMethod "$base/api/admin/subscription-orders" -WebSession $adminSession
  if (@($pendingOrders | Where-Object id -eq $order.id).Count -ne 1) { throw 'Admin cannot see pending subscription order' }
  $receipt = Invoke-WebRequest "$base/api/admin/subscription-orders/$($order.id)/receipt" -WebSession $adminSession
  if ($receipt.StatusCode -ne 200 -or $receipt.Headers['Content-Type'] -notmatch 'image/png') { throw 'Uploaded receipt could not be viewed' }
  $orderApproved = PostJson "/admin/subscription-orders/$($order.id)/decision" @{decision='approve'} $adminSession
  if ($orderApproved.status -ne 'paid') { throw 'Subscription order was not approved' }
  $merchantSubscriptions = Invoke-RestMethod "$base/api/merchant/subscription" -WebSession $ownerSession
  if (@($merchantSubscriptions | Where-Object id -eq $orderApproved.subscriptionId).Count -ne 1) { throw 'Approved order did not create visible subscription' }
  $secondApprovalBlocked = $false
  try { $null = PostJson "/admin/subscription-orders/$($order.id)/decision" @{decision='approve'} $adminSession } catch { $secondApprovalBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $secondApprovalBlocked) { throw 'Subscription order approved twice' }
  $crossOrders = Invoke-RestMethod "$base/api/merchant/subscription/orders" -WebSession $otherSession
  if (@($crossOrders | Where-Object id -eq $order.id).Count -ne 0) { throw 'Subscription order leaked across tenants' }
  $newSku = "NEW-$id"
  $newPurchase = PostJson '/merchant/accounting/purchases' @{idempotencyKey="new-stock-$id";supplierName='تأمین‌کنندهٔ جدید';supplierInvoiceNumber='N-1';paidRial=0;lines=@(@{productId=$null;quantity=2;unitCostRial=120000;newProduct=@{name='کالای تازه';sku=$newSku;category='کیف/چرم';priceRial=180000}})} $ownerSession
  if ($newPurchase.totalRial -ne 240000) { throw 'Purchase with a new product has wrong total' }
  $createdStock = Invoke-RestMethod "$base/api/merchant/products?q=$newSku" -WebSession $ownerSession
  if (@($createdStock).Count -ne 1 -or $createdStock[0].stock -ne 2 -or $createdStock[0].priceRial -ne 180000) { throw 'New product was not registered and stocked atomically' }
  $categoryProducts = Invoke-RestMethod "$base/api/merchant/products?category=$([uri]::EscapeDataString('کیف'))" -WebSession $ownerSession
  if (@($categoryProducts | Where-Object id -eq $createdStock[0].id).Count -ne 1) { throw 'Parent category did not include nested products' }
  $chosenPurchaseDate = [datetime]::UtcNow.AddDays(-2).ToString('o')
  $deferredPurchase = PostJson '/merchant/accounting/purchases' @{idempotencyKey="deferred-stock-$id";supplierName='تأمین‌کنندهٔ دوم';supplierInvoiceNumber='N-2';paidRial=0;purchasedAt=$chosenPurchaseDate;lines=@(@{productId=$createdStock[0].id;quantity=4;stockQuantity=0;unitCostRial=100000})} $ownerSession
  $afterDeferred = Invoke-RestMethod "$base/api/merchant/products?q=$newSku" -WebSession $ownerSession
  if ($deferredPurchase.totalRial -ne 400000 -or $afterDeferred[0].stock -ne 2) { throw 'Deferred purchase incorrectly changed inventory' }
  $purchaseList = Invoke-RestMethod "$base/api/merchant/accounting/purchases" -WebSession $ownerSession
  $datedPurchase = @($purchaseList | Where-Object id -eq $deferredPurchase.id)[0]
  $storedUtc = [datetime]::SpecifyKind([datetime]$datedPurchase.purchasedAt, [DateTimeKind]::Utc)
  if ([math]::Abs(($storedUtc - [DateTimeOffset]::Parse($chosenPurchaseDate).UtcDateTime).TotalSeconds) -gt 1) { throw "Manual purchase date was not preserved: expected $chosenPurchaseDate, got $($datedPurchase.purchasedAt)" }
  $invalidStockBlocked = $false
  try { $null = PostJson '/merchant/accounting/purchases' @{idempotencyKey="invalid-stock-$id";supplierName='نامعتبر';paidRial=0;lines=@(@{productId=$createdStock[0].id;quantity=2;stockQuantity=3;unitCostRial=100000})} $ownerSession } catch { $invalidStockBlocked = $_.Exception.Response.StatusCode -eq 400 }
  if (-not $invalidStockBlocked) { throw 'Purchase accepted more received stock than purchased quantity' }
  $quickPriceProduct = PutJson "/merchant/products/$($createdStock[0].id)/price" @{expectedPriceRial=180000;newPriceRial=190000} $ownerSession
  if ($quickPriceProduct.priceRial -ne 190000 -or $quickPriceProduct.stock -ne 2) { throw 'Quick price edit changed inventory or failed' }
  $staleQuickPriceBlocked = $false
  try { $null = PutJson "/merchant/products/$($createdStock[0].id)/price" @{expectedPriceRial=180000;newPriceRial=200000} $ownerSession } catch { $staleQuickPriceBlocked = $_.Exception.Response.StatusCode -eq 409 }
  if (-not $staleQuickPriceBlocked) { throw 'Stale quick price edit overwrote current price' }
  $searchOwn = Invoke-RestMethod "$base/api/merchant/search?q=$([uri]::EscapeDataString($newSku))" -WebSession $ownerSession
  $searchOther = Invoke-RestMethod "$base/api/merchant/search?q=$([uri]::EscapeDataString($newSku))" -WebSession $otherSession
  if (@($searchOwn | Where-Object id -eq $createdStock[0].id).Count -ne 1 -or @($searchOther).Count -ne 0) { throw 'Global search did not isolate tenant data' }
  $expense = PostJson '/merchant/accounting/expenses' @{category='حمل';description='ارسال اولیه';amountRial=50000;incurredAt=$chosenPurchaseDate} $ownerSession
  $expenseUpdated = PutJson "/merchant/accounting/expenses/$($expense.id)" @{category='حمل';description='ارسال اصلاح‌شده';amountRial=60000;incurredAt=$chosenPurchaseDate;reason='اصلاح مبلغ سند'} $ownerSession
  if ($expenseUpdated.amountRial -ne 60000 -or $expenseUpdated.description -ne 'ارسال اصلاح‌شده') { throw 'Expense correction failed' }
  $replacementPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20))
  $null = PostJson "/admin/users/$($staff.id)/reset-password" @{newPassword=$replacementPassword} $adminSession
  $oldStaffSessionValid = $true
  try { $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession } catch { $oldStaffSessionValid = $_.Exception.Response.StatusCode -ne 401 }
  if ($oldStaffSessionValid) { throw 'Password reset left old session valid' }
  $null = PostJson '/auth/login' @{username=$renamedStaff;password=$replacementPassword} $staffSession $true
  $null = Invoke-RestMethod "$base/api/merchant/products" -WebSession $staffSession
  Write-Output 'PASS: 20 tenants; idempotent subscriptions/orders; promo quote and receipt approval; username and password reset session revocation; staff/admin activity; customer profile and receivable badge; purchase-created stock; existing invoice, return, cheque, AI fallback, brand, archive, isolation and CSRF scenarios'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Write-Output "Test log: $log"
}
