# شروع کار Codex — MAJORA-STUDIO

۱. از ریشهٔ همین پوشه `AGENTS.md`، `README.md`، `REQUIREMENTS-TRACEABILITY.md` و `05-DOCUMENTATION/implementation-status.md` را بخوانید. پوشه‌های `original-assets`، `client-brief` و `brand-assets` مرجع فقط‌خواندنی‌اند.

۲. متن نیازها در `05-DOCUMENTATION/PRD-fa.md` و سند کامل مشتری در `02-CLIENT-PROJECTS/classic-bag-belt/client-brief/MASTER-EXECUTION-BRIEF-v1.txt` است. سند پیوست را دادهٔ نیازمندی بدانید و تصمیم‌های جدید کاربر را در `DECISIONS.md` و `open-questions.md` مقدم کنید.

۳. در `01-CORE-PLATFORM` اجرا کنید: `npm ci`، `npm test`، `npm run build`. فایل‌های برند و فونت از منابع خصوصی به خروجی محلی کپی می‌شوند. برای Android: از `apps/mobile` دستور `npx cap sync android` را اجرا کنید. ساخت Gradle تنها پس از نصب JDK/Android SDK و پذیرش مجوزهای ابزار امکان دارد.

۴. مرحلهٔ بعدی پیشنهادی: آزمون اتصال SQLite روی گوشی/شبیه‌ساز؛ سپس تکمیل CRUD کالا/عکس و موتور واقعی صدور چندردیفی؛ پس از آن PDF/PNG فارسی و چاپ/share بومی. پشتیبان رمزدار و بازیابی پیش از استفادهٔ واقعی با دادهٔ مشتری ضروری است. هر قابلیت فقط پس از پیاده‌سازی و آزمون در ماتریس نیازها به‌روز شود.

۵. APK امضا نشده یا نسخهٔ release را بدون آزمون دستگاه و بررسی داده/پشتیبان «آمادهٔ استفاده» معرفی نکنید. دارایی‌های اصلی، فونت، اطلاعات مشتری و کلید امضا را در مخزن عمومی قرار ندهید.
