# وضعیت ساخت Android و مسیر خروجی آزمایشی

در ۲۱ اکتبر ۲۰۲۶، Java 17 رسمی Microsoft در `D:\desktop\MAJORA-BUILD-TOOLS\jdk17\jdk-17.0.20.1+1` راستی‌آزمایی شد؛ اجرای ابری شمارهٔ `39590835556` نشان داد این نسخه برای Capacitor 8 کافی نیست: `invalid source release: 21`. ساخت Android اکنون به Java 21 تنظیم شده است. Android SDK و Gradle اجراشده در Windows در دسترس نیستند. لینک دانلود رسمی Google برای Command Line Tools در `dl.google.com` با ۴۰۴ پاسخ داد؛ دریافت از CDN رسمی با reset/timeout قطع شد. کاربر قرارداد SDK را پذیرفت، اما **هنوز APK واقعی ساخته نشده است**.

`01-CORE-PLATFORM/tooling/build-android-debug.ps1` مسیرهای واقعی Java و SDK را به عنوان ورودی می‌گیرد؛ قبل از ساخت، نسخهٔ Java 21 و وجود Platform 36 را بررسی می‌کند. پس از موفقیت تست، build وب، sync و Gradle، APK را فقط در `06-BUILDS-AND-RELEASES/debug/` کپی می‌کند و SHA-256 چاپ می‌کند. اگر هر مرحله شکست بخورد، خروجی موفق ادعا نمی‌کند.

`.github/workflows/android-debug.yml` برای اجرای دستی روی runner رسمی `ubuntu-24.04` آماده است. این runner طبق فهرست رسمی GitHub دارای Android SDK Platform 36 و Build Tools است. مخزن خصوصی `animationahmad78-code/MAJORA-STUDIO` ایجاد و سورس به شاخهٔ `main` فرستاده شد. بستهٔ خصوصی دارایی‌ها در prerelease داخلی `private-assets-v1` با SHA-256 ثابت قرار گرفت؛ workflow آن را با `GITHUB_TOKEN` همان مخزن دریافت و هش را بررسی می‌کند. اجرای نخست تا مرحلهٔ Gradle پیش رفت و به دلیل Java 17 شکست خورد؛ اصلاح Java 21 در دست آزمون است. خروجی احتمالی آن **Debug APK برای QA** است، نه نسخهٔ Release تجاری.

گیت‌های باقی‌مانده: اجرای واقعی Gradle و بررسی APK، نصب روی گوشی، آزمون SQLite آفلاین و ارتقا، چاپ/بازگردانی، رفع قابلیت‌های ناقص، سپس امضای Release با keystore اختصاصی خارج از سورس. تا گذر از این گیت‌ها، نسخهٔ قابل فروش تأیید نشده است.
