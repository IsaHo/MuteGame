# وضعیت فعلی

آخرین ممیزی: 2026-07-25

## کدهای فعال

- `server/`: Node.js، Express، Socket.IO و SQLite.
- `qt/admin/`: پنل ادمین فعال با Qt 6 و QML؛ سرور Node به‌صورت embedded اجرا می‌شود.
- `qt/client/`: کلاینت kiosk فعال با Qt 6 و QML.
- `admin/` و `client/`: نسل React/Electron قدیمی؛ تا تصمیم مهاجرت حذف نشوند.

## قابلیت‌های ساخته‌شده

- ثبت و reconnect کلاینت با Socket.IO v4.
- login/logout، نشست و کسر زمان.
- kiosk و سیاست‌های Windows، recovery و watchdog.
- اجرای چند بازی و جابه‌جایی `Ctrl+Tab`.
- کنترل سیستم‌ها، پیام، voice، پاور، تخصیص کاربر و شبکه.
- فروشگاه، سفارش و اعلان ادمین.
- کاتالوگ بازی و کتابخانه تصویر.
- کاربران، ادمین‌ها، نقش‌ها و audit.
- credit ledger، بازیابی نشست، backup و crash reporting در commits اخیر.

## ریسک‌های فعلی

- شاخه `main` نسبت به `origin/main` بیست‌ودو commit جلو است.
- worktree شامل تغییرات قدیمی و جدید متعدد است.
- `client/renderer/src/main.jsx` از stash/apply conflict داشته؛ محتوای فعلی ترکیب lockdown و crash reporting است و باید فقط پس از تست mark-resolved شود.
- فایل‌های تولیدی، `.DS_Store`، دیتابیس و executableها نباید وارد commit سورس شوند.
- نسل Electron و Qt هم‌زمان وجود دارند؛ Qt مرجع محصول جدید است اما باید migration policy مکتوب بماند.

## بسته Windows

`~/Desktop/MuteGame-Windows-FINAL.zip` شامل source، toolchain portable، Node portable و build scripts است. هر release باید از commit مشخص ساخته و checksum آن ثبت شود.
