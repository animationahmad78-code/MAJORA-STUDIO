# گزارش نسخهٔ نامزد Android — کیف و کمربند کلاسیک

تاریخ ساخت در CI: ۲۳ اکتبر ۲۰۲۶ UTC؛ سورس: commit `9c31e4e38de4251da7a3e75670b903c675e28db3`.

## فایل تحویل

| مورد | مقدار تأییدشده |
|---|---|
| APK محلی | `06-BUILDS-AND-RELEASES/classicbag-2026-10-22-rc/app-release.apk` |
| بستهٔ سورس منطبق | `06-BUILDS-AND-RELEASES/classicbag-2026-10-22-rc/majora-source-9c31e4e.zip` |
| اندازهٔ APK | ۱۸٬۴۴۰٬۶۸۱ بایت |
| SHA-256 APK | `D2FE54D319E73EDAFEC0CB21FA4DB71E97C4A95A5312F5BED3CD093201D41175` |
| SHA-256 سورس ZIP | `A17BDF832AA72EDB8DAEED817EA813C8575C36FF1739CB440AFF9CE92C040C53` |
| شناسهٔ بسته | `ir.majora.classicbag` |
| شماره و نام نسخه | `versionCode=2` / `versionName=1.0.0` |
| امضا | APK Signature Scheme v2، RSA 4096، یک امضاکننده |
| SHA-256 گواهی | `05BE76DABF67AFFCF51FB014BE2DD4F843270FB4CA2DB239E9A76436889DFC37` |

## شواهد اجرای واقعی

- [اجرای Android Release در GitHub Actions](https://github.com/animationahmad78-code/MAJORA-STUDIO/actions/runs/39881363264): ۲۲ آزمون موفق، بیلد وب و Gradle، تأیید امضا با `apksigner`، تأیید بسته/نسخه با `aapt`، هش یکسان با فایل دانلودشده، نصب و باقی‌ماندن برنامه در حال اجرا روی شبیه‌ساز Android 35.
- تصویر صفحهٔ خانۀ Release در `06-BUILDS-AND-RELEASES/classicbag-2026-10-22-rc/emulator/majora-release-home.png` ذخیره شد و محتوای صفحه بررسی شد.
- [کامپایل iOS Simulator](https://github.com/animationahmad78-code/MAJORA-STUDIO/actions/runs/39881366598) و [بررسی سورس](https://github.com/animationahmad78-code/MAJORA-STUDIO/actions/runs/39881352150) روی همان commit موفق شدند. IPA امضاشده ساخته نشده است.
- در مرورگر نمونه، پیش‌نمایش فارسی، PDF A4، PDF دوصفحه‌ای A5 و PNG تک‌رنگ دوصفحه‌ای آزمایش شدند. اجرای اشتراک/چاپ native، دوربین و بازیابی پشتیبان هنوز آزمایش نشده است.

## نصب

فایل APK را به گوشی منتقل و باز کنید، سپس نصب از منبع انتخاب‌شده را برای فایل‌منیجر مجاز کنید. اگر نسخهٔ آزمایشی Debug با همین شناسه از قبل نصب است، امضای آن متفاوت است و ارتقای مستقیم ممکن نیست؛ پیش از حذف هر نصب دارای داده، راه بازیابی آن داده را بررسی کنید. برای به‌روزرسانی نسخه‌های Release بعدی، همین کلید امضا و `versionCode` بزرگ‌تر حفظ می‌شود.

## وضعیت تحویل

این فایل **واقعی، امضاشده و قابل نصب** است، اما «نسخهٔ نهایی تجاریِ بی‌نقص» نام‌گذاری نمی‌شود: چاپ روی پرینتر واقعی، اشتراک فایل، دوربین، پشتیبان/بازیابی از نصب تمیز، ارتقا با داده و همهٔ ۲۷ درخواست اخیر روی گوشی اجرا نشده‌اند. حذف دائم از بایگانی، پاک‌کردن تاریخچه، ورود/خروج Excel و کنترل ریز هر فیلد قالب نیز هنوز کامل نیستند. وضعیت کامل در `DELIVERY-STATUS-2026-10-22.md` آمده است.
