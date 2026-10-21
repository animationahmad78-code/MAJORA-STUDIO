# آماده‌سازی iOS و ساخت ابری

## وضعیت واقعی

پروژهٔ native iOS با همان شناسهٔ موجود `ir.majora.classicbag` و Capacitor 8.5.3 در `01-CORE-PLATFORM/apps/mobile/ios` ایجاد و `cap sync ios` روی Windows موفق شد. افزونهٔ SQLite در `Package.swift` شناسایی شد. مسیر Windows تولیدشده در SPM با اسکریپت `sync:ios` به جداکنندهٔ قابل استفاده در macOS تبدیل می‌شود. اینها **اثبات کامپایل Xcode، اجرای iPhone یا تولید IPA نیستند**.

Capacitor 8 برای ساخت iOS به macOS و Xcode 26 یا جدیدتر نیاز دارد. فایل `.github/workflows/ios-compile.yml` یک بررسی دستی روی runner `macos-26` برای ساخت **بدون امضای شبیه‌ساز** آماده می‌کند. سورس به مخزن خصوصی GitHub متصل شده، اما workflow هنوز اجرا نشده است.

## دارایی‌های خصوصی در CI

دارایی‌های اصلی و فونت‌ها عمداً در تاریخچهٔ Git نیستند. ZIP خصوصی در prerelease داخلی `private-assets-v1` مخزن خصوصی قرار دارد. workflow با `GITHUB_TOKEN` دارای دسترسی خواندن همان مخزن آن را دریافت می‌کند و هش ثابت را پیش از استخراج بررسی می‌کند. اگر مخزن عمومی شود، دارایی Release نیز در معرض دید قرار می‌گیرد؛ خصوصی‌ماندن مخزن شرط این روش است.

ZIP شامل `00-COMPANY/brand-assets/IMG_1137.PNG`، `02-CLIENT-PROJECTS/classic-bag-belt/original-assets/ClassicBag-mark.png`، `02-CLIENT-PROJECTS/classic-bag-belt/design-system/fonts/Estedad-*.woff2` و `02-CLIENT-PROJECTS/classic-bag-belt/brand-config/store.json` با همین مسیرهاست. فایل ZIP و اطلاعات فروشگاه در commit قرار نگرفته‌اند.

بستهٔ خصوصی فعلی در `07-BACKUPS/ios-private-assets-2026-10-21.zip` با ۷ فایل و ۲٬۱۵۵٬۳۷۵ بایت ساخته و فهرست آن بررسی شد. SHA-256 آن `1FEBB3ED436FFAA7C3BFD0545313A57B86999F8634E40FB77D3E96CD6F59DB3D` است. GitHub پس از بارگذاری، همین اندازه و digest را برای دارایی Release گزارش کرد.

## گیت‌های بعدی

1. اجرای واقعی workflow و رفع خطاهای احتمالی Xcode/SPM/SQLite؛ سپس تست آفلاین روی iPhone.
2. جایگزینی آیکن پیش‌فرض iOS با نشان تأییدشدهٔ فروشگاه در نسخهٔ قابل انتشار؛ فایل اصلی را تغییر ندهید.
3. تکمیل PDF/چاپ/فایل/بازیابی در iOS و آزمون فونت و راست‌چین روی دستگاه.
4. پس از تکمیل QA، حساب Apple Developer، Team ID، provisioning profile و گواهی توزیع لازم است. اطلاعات امضا در Secrets/خزانهٔ امن نگهداری می‌شود. تا آن زمان IPA امضاشده وجود ندارد.

## روش محلی روی macOS

با پوشهٔ کامل پروژه و دارایی‌های خصوصی در مسیرهای بالا، در ریشهٔ `01-CORE-PLATFORM` اجرا شود:

```sh
npm ci
npm test
npm run build
npm run sync:ios -w @majora/mobile
cd apps/mobile
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

این دستور صرفاً کامپایل شبیه‌ساز را بررسی می‌کند و خروجی قابل نصب روی گوشی یا IPA توزیعی نمی‌سازد.
