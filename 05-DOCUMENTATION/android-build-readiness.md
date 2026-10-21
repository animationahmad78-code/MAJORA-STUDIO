# وضعیت ساخت Android و مسیر خروجی آزمایشی

در ۲۱ اکتبر ۲۰۲۶، اجرای ابری شمارهٔ `39590835556` نشان داد Java 17 برای Capacitor 8 کافی نیست: `invalid source release: 21`. workflow به Java 21 اصلاح شد. Android SDK و Gradle اجراشده در میزبان Windows هنوز در دسترس نیستند، اما ساخت ابری Android موفق شد و **Debug APK واقعی** در `06-BUILDS-AND-RELEASES/debug/classicbag-debug-verified-run-39599628878.apk` موجود است. جزئیات هش، امضا و نصب در `qa-debug-apk-2026-10-21.md` ثبت شده‌اند.

`01-CORE-PLATFORM/tooling/build-android-debug.ps1` مسیرهای واقعی Java و SDK را به عنوان ورودی می‌گیرد؛ قبل از ساخت، نسخهٔ Java 21 و وجود Platform 36 را بررسی می‌کند. پس از موفقیت تست، build وب، sync و Gradle، APK را فقط در `06-BUILDS-AND-RELEASES/debug/` کپی می‌کند و SHA-256 چاپ می‌کند. اگر هر مرحله شکست بخورد، خروجی موفق ادعا نمی‌کند.

`.github/workflows/android-debug.yml` روی runner `ubuntu-24.04` با Java 21، Android SDK Platform 36 و Build Tools اجرا می‌شود. اجرای شمارهٔ `39599628878`، آزمون‌ها، build، sync، Gradle، اعتبارسنجی امضای v2 با `apksigner` و شناسهٔ بسته با `aapt` را گذراند. APK استخراج‌شده با هش ثبت‌شده در CI برابر است. بنا به تصمیم مالک، فایل‌های برند و workflow ساخت در همین مخزن عمومی‌اند و ساخت بعدی به مخزن دوم وابسته نیست. این فایل **Debug APK برای QA** است.

گیت‌های باقی‌مانده: نصب روی گوشی، آزمون SQLite آفلاین و ارتقا، چاپ/بازگردانی، رفع قابلیت‌های ناقص، سپس امضای Release با keystore اختصاصی خارج از سورس. تا گذر از این گیت‌ها، نسخهٔ قابل فروش تأیید نشده است.
