# ممیزی مالی Claude Code

تاریخ: 2026-07-25  
حالت: read-only، بازبینی‌شده توسط مدیر پروژه

## نتیجه

زیرساخت مالی از چیزی که مستندات قدیمی نشان می‌دادند جلوتر است:

- `credit_ledger` append-only با trigger و constraint وجود دارد.
- mutationهای مالی در `server/billing.js` متمرکز شده‌اند.
- optimistic concurrency، session close idempotent، debt و recovery ساخته شده‌اند.
- backup و crash reporting وجود دارد.

## شکاف‌های تأییدشده

### P0 - Shift Close

جدول و workflow بستن شیفت وجود ندارد. اپراتور نمی‌تواند صندوق ابتدا/انتها، روش‌های پرداخت، اختلاف صندوق و تأیید نهایی را ثبت کند.

### P0 - Reconciliation عملیاتی

`manualReconciliation()` در `server/billing.js` وجود دارد، اما route و UI کنترل‌شده برای اجرای آن وجود ندارد. این عملیات باید permission ویژه، reason اجباری، preview اختلاف و audit داشته باشد.

### P0 - هزینه‌ها server-side نیستند

هزینه‌ها در `qt/admin/src/ExpenseStore` و QSettings همان دستگاه ذخیره می‌شوند. بنابراین backup مرکزی، چند ادمین، گزارش معتبر و audit کامل ندارند.

### P1 - Free Session Contract

تیکر `server/index.js` برای `limit_time` مسیر رایگان دارد و ادعای «همیشه کسر می‌شود» دقیق نبود. با این حال `closeSession()` مستقیماً `billSessionUntilLocked()` را فراخوانی می‌کند؛ باید تست integration ثابت کند final flush برای کاربر رایگان charge ایجاد نمی‌کند.

### P1 - Crash Billing

بازیابی نشست وجود دارد، اما سناریوی crash میان دو tick باید با test ثابت کند زمان مصرف‌شده دقیقاً یک‌بار ledger می‌شود.

## Milestone مصوب پیشنهادی: Financial Trust P0

1. expense ledger و endpointهای server-side.
2. shift schema و open/close workflow.
3. cash/card/transfer/wallet payment method.
4. reconciliation report و عملیات اصلاح با permission.
5. integration tests برای shift، expense، free session و crash.

## معیار پذیرش

- هزینه روی هر ادمین یکسان و داخل backup باشد.
- هر shift سند immutable و operator مشخص داشته باشد.
- جمع روش‌های پرداخت با صندوق اعلامی reconcile شود.
- هیچ session باز بعد از close shift باقی نماند یا exception آن ثبت شود.
- اختلاف balance و ledger صفر یا دارای reconciliation سنددار باشد.
- کاربر `limit_time` در تمام مسیرهای ticker/logout/crash charge نشود.

## گزارش خام Claude

Claude قابلیت‌های ledger، recovery، backup، debt و crash reporting را تأیید کرد و نبود shift-close و route reconciliation را گزارش داد. ادعای اولیه آن درباره `limit_time` پس از بازبینی اصلاح شد: bypass در ticker وجود دارد، اما پوشش final flush نیازمند تست است.
