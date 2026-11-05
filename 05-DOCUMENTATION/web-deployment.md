# راه‌اندازی و استقرار وب MAJORA

## پیش‌نیاز سرور

هاست باید **ASP.NET Core 10** را به صورت فرایند ماندگار اجرا کند؛ **SQL Server** قابل اتصال، HTTPS، امکان تنظیم متغیر محیطی، پوشهٔ خصوصی پایدار برای کلیدهای Data Protection، دسترسی به لاگ و امکان پشتیبان‌گیری دیتابیس لازم است. Windows/IIS یا Linux با Kestrel و reverse proxy قابل استفاده‌اند. هاست PHP/DirectAdmin صرفاً به دلیل داشتن DirectAdmin برای اجرای این API کافی نیست. پیش از خرید، پشتیبانی دقیق runtime، SQL Server و background process را از میزبان تأیید کنید.

برای شروعِ ایمن، `app.majoraapp.ir` یا زیردامنهٔ اختصاصی را به این سرویس وصل کنید؛ سایت فعلی در دامنهٔ دیگر دست‌نخورده می‌ماند. `AllowedHosts` را روی همان نام میزبان تنظیم کنید.

## توسعهٔ محلی ویندوز

```powershell
cd 'D:\desktop\MAJORA-STUDIO\01-CORE-PLATFORM'
npm ci
npm run build -w @majora/web
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:MAJORA_BOOTSTRAP_USER = 'admin-local'
$env:MAJORA_BOOTSTRAP_PASSWORD = '<رمز طولانی تصادفی محلی>'
& "$env:LOCALAPPDATA\MajoraTools\dotnet\dotnet.exe" run --project apps/web-api/Majora.WebApi.csproj --urls http://127.0.0.1:5180
```

API در `http://127.0.0.1:5180` و وب در همان آدرس باز می‌شود. کاربر مدیر فقط وقتی جدول کاربران خالی است از متغیرهای محیطی ساخته می‌شود. رمز را داخل فایل پروژه، PowerShell history، Git یا اسکرین‌شات قرار ندهید. برای آزمون خودکار `tooling/test-web-api.ps1` را با **PowerShell 7 (`pwsh`)** اجرا کنید؛ این اسکریپت رمز و دیتابیس موقت جداگانه می‌سازد.

## ساخت بستهٔ Windows/IIS

```powershell
cd 'D:\desktop\MAJORA-STUDIO\01-CORE-PLATFORM'
npm ci
npm run build -w @majora/web
dotnet publish apps/web-api/Majora.WebApi.csproj -c Release -r win-x64 --self-contained false -o ../../06-BUILDS-AND-RELEASES/web-win-x64
```

در سرور IIS، .NET 10 Hosting Bundle رسمی و ASP.NET Core Module باید نصب باشد. Application Pool در حالت No Managed Code و زیر HTTPS تنظیم شود. فایل‌های publish در مسیر برنامه قرار گیرند؛ `web.config` توسط publish تولید می‌شود. اگر میزبان دسترسی نصب Runtime نمی‌دهد، بستهٔ self-contained فقط پس از بررسی محدودیت هاست و حجم مجاز گزینه است.

متغیرهای **اجباری** Production:

| نام | مقدار/هدف |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Database__Provider` | `SqlServer` |
| `ConnectionStrings__SqlServer` | اتصال SQL Server با کاربر اختصاصی و TLS |
| `MAJORA_KEYS_DIRECTORY` | مسیر پایدار خصوصی، خارج از `wwwroot`، با دسترسی فقط حساب برنامه |
| `AllowedHosts` | نام میزبان واقعی وب |
| `MAJORA_BOOTSTRAP_USER` و `MAJORA_BOOTSTRAP_PASSWORD` | فقط نخستین راه‌اندازی؛ پس از ساخت مدیر حذف شوند |

برای استقرار پشت Nginx یا reverse proxy که TLS را خاتمه می‌دهد، `MAJORA_TRUSTED_PROXY_IP` را فقط روی IP واقعی همان پراکسی تنظیم کنید. برنامه تنها هدرهای `X-Forwarded-For` و `X-Forwarded-Proto` آن IP را می‌پذیرد؛ تنظیم عمومی و بدون محدودیت پراکسی مجاز نیست.

اختیاری برای مشاور متنی: `MAJORA_AI_ENDPOINT` (HTTPS و سازگار با Chat Completions)، `MAJORA_AI_MODEL` و `MAJORA_AI_API_KEY`. سرویس خارجی ممکن است در شبکهٔ ملی در دسترس نباشد؛ بدون آن تحلیل قاعده‌ای در خود سرور کار می‌کند. پیش از روشن کردن AI بیرونی، محل پردازش داده، هزینه، دسترس‌پذیری و قرارداد حفاظت داده بررسی شود.

## ترتیب راه‌اندازی

1. SQL Server جداگانه با دیتابیس خالی و کاربر محدود بسازید. از TLS و نسخهٔ پشتیبان خودکار استفاده کنید.
2. پوشهٔ خصوصی Data Protection را روی دیسک پایدار بسازید؛ کلیدها برای باز شدن کوکی‌ها پس از restart ضروری‌اند. این پوشه و دیتابیس را جداگانه پشتیبان بگیرید.
3. متغیرها را از پنل امن میزبان یا تنظیمات فرایند وارد کنید. رمز و connection string را در `appsettings.json` ننویسید.
4. اسکریپت idempotent مهاجرت SQL Server همراه بسته (`MAJORA-web-sqlserver-migrations.sql`) را بازبینی و نخست روی دیتابیس آزمایشی اجرا کنید. سپس از دیتابیس اصلی پشتیبان بگیرید و همان اسکریپت را در پنجرهٔ استقرار روی آن اجرا کنید. برنامه در Production مهاجرت را خودکار اجرا نمی‌کند و تا آماده شدن schema بالا نمی‌آید. کاربر زمان اجرای برنامه می‌تواند دسترسی DDL نداشته باشد.
5. فایل publish را آپلود و برنامه را زیر HTTPS راه‌اندازی کنید.
6. `/api/health` را بررسی کنید، با مدیر وارد شوید، طرح بسازید، فروشگاه بسازید و اشتراک فعال ثبت کنید. سپس با حساب مالک همان فروشگاه وارد شوید.
7. دادهٔ واقعی Android را تا آماده شدن ابزار انتقال وارد نکنید. آزمون SQL Server، چاپ و بازیابی پشتیبان را پیش از بهره‌برداری تجاری انجام دهید.

## بروزرسانی و بازگشت

نسخهٔ کد، خروجی publish و شمارهٔ migration را باهم نگه دارید. قبل از ارتقا نسخهٔ کامل SQL Server و پوشهٔ کلیدها را بگیرید و بازیابی را روی محیط جدا آزمایش کنید. بازگردانی فقط با بازگرداندن همزمان فایل‌های برنامه و دیتابیس سازگار انجام شود؛ rollback فایل بدون rollback schema ممکن است داده را خراب کند.

## نکات عملیاتی

- کوکی نشست HttpOnly و SameSite Strict است؛ برای Production فقط HTTPS پذیرفته می‌شود. در reverse proxy لینوکس هدرهای forwarded و proxyهای مورد اعتماد را مطابق مستندات رسمی ASP.NET Core تنظیم کنید.
- از بانک اطلاعاتی عمومی یا دیتابیس مشترک سایت فعلی استفاده نکنید. دسترسی شبکهٔ SQL Server را فقط به سرور وب محدود کنید.
- برنامهٔ زمانی پشتیبان روزانه و نگهداری چندنسخه‌ای، مانیتورینگ خطا/فضا/پرداخت اشتراک و آزمون ماهانهٔ بازیابی را در سرویس میزبان فعال کنید.
- اتصال پیامک، پرداخت آنلاین اشتراک، Web Push و دادهٔ اپ Android در این فاز آماده نیستند؛ فعال‌سازی ظاهری آنها در UI انجام نشده است.

منابع فنی رسمی: [میزبانی ASP.NET Core با IIS](https://learn.microsoft.com/aspnet/core/host-and-deploy/iis/)، [میزبانی لینوکس با Nginx](https://learn.microsoft.com/aspnet/core/host-and-deploy/linux-nginx)، [مهاجرت EF Core](https://learn.microsoft.com/ef/core/managing-schemas/migrations/applying).
