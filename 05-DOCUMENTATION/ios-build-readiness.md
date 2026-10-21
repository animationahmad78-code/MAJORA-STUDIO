# آماده‌سازی iOS و ساخت ابری

## وضعیت واقعی

پروژهٔ native iOS با همان شناسهٔ موجود `ir.majora.classicbag` و Capacitor 8.5.3 در `01-CORE-PLATFORM/apps/mobile/ios` ایجاد و `cap sync ios` روی Windows موفق شد. افزونهٔ SQLite در `Package.swift` شناسایی شد. مسیر Windows تولیدشده در SPM با اسکریپت `sync:ios` به جداکنندهٔ قابل استفاده در macOS تبدیل می‌شود. اجرای GitHub Actions شمارهٔ `39592246513` کامپایل **بدون امضای شبیه‌ساز** را با موفقیت گذراند. این هنوز اجرای iPhone یا تولید IPA نیست.

Capacitor 8 برای ساخت iOS به macOS و Xcode 26 یا جدیدتر نیاز دارد. workflow `.github/workflows/ios-compile.yml` بررسی دستی روی runner `macos-26` را اجرا کرد و موفق شد. ساخت بعدی از همین مخزن عمومی انجام می‌شود.

## دارایی‌های برند در CI

طبق تصمیم صریح مالک، لوگوها، مرجع فاکتور، چهار وزن Estedad و تنظیمات عمومی فروشگاه در همین مخزن نسخه‌بندی می‌شوند. `prepare-brand.mjs` فایل‌های اصلی را دست‌نخورده به خروجی build کپی می‌کند. سابقهٔ پشتیبان ZIP در `07-BACKUPS/ios-private-assets-2026-10-21.zip` باقی می‌ماند ولی build به آن وابسته نیست. منشأ دقیق چهار باینری فونت برای انتشار تجاری هنوز در `open-questions.md` باز است.

## گیت‌های بعدی

1. اجرای واقعی workflow و رفع خطاهای احتمالی Xcode/SPM/SQLite؛ سپس تست آفلاین روی iPhone.
2. جایگزینی آیکن پیش‌فرض iOS با نشان تأییدشدهٔ فروشگاه در نسخهٔ قابل انتشار؛ فایل اصلی را تغییر ندهید.
3. تکمیل PDF/چاپ/فایل/بازیابی در iOS و آزمون فونت و راست‌چین روی دستگاه.
4. پس از تکمیل QA، حساب Apple Developer، Team ID، provisioning profile و گواهی توزیع لازم است. اطلاعات امضا در Secrets/خزانهٔ امن نگهداری می‌شود. تا آن زمان IPA امضاشده وجود ندارد.

## روش محلی روی macOS

از checkout کامل همین مخزن، در ریشهٔ `01-CORE-PLATFORM` اجرا شود:

```sh
npm ci
npm test
npm run build
npm run sync:ios -w @majora/mobile
cd apps/mobile
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

این دستور صرفاً کامپایل شبیه‌ساز را بررسی می‌کند و خروجی قابل نصب روی گوشی یا IPA توزیعی نمی‌سازد.
