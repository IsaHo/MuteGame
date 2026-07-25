# Brain Changelog

## 2026-07-25 (expense vertical slice hardening)

- `expense-service.js`: اضافه شدن `isValidGregorianDate` — جلوگیری از تاریخ‌های غیرممکن مانند ۲۰۲۶-۰۲-۳۱.
- `expense-service.js`: `importExpenses` حالا همه آیتم‌ها را قبل از transaction بررسی می‌کند؛ هر آیتم نامعتبر → ۴۰۰ با شماره ردیف فارسی. `skipped` فقط به معنی تکرار idempotency است.
- `expense-service.js`: محدودیت‌های جدید: category 1-50، idempotency_key 1-200، void_reason ≤500.
- `routes/expenses.js`: GET حالا `date_from > date_to` و category بلند را رد می‌کند.
- `ExpenseStore.cpp`: `migrationItems()` کلید `idempotency_key = "local_" + id` را به هر آیتم فاقد آن اضافه می‌کند.
- `ExpenseStore.h`: کامنت قدیمی «سرور expenses ندارد» حذف و وضعیت واقعی ثبت شد.
- `AccountingPage.qml`: migration فقط در صورتی کامل می‌شود که `imported + skipped === batchSize`.
- `tests/expenses.test.js`: پوشش تاریخ غیرممکن، import اتمیک، روش پرداخت، trim دسته‌بندی و idempotency. کل ۱۴ تست پاس.
- خطای migration در پنل ادمین نمایش داده می‌شود و تا تأیید کامل سرور، داده محلی حذف یا نهایی نمی‌شود.
- Qt admin build: clean compile.

## 2026-07-25

- مغز رسمی پروژه ساخته شد.
- چشم‌انداز، معماری، حسابداری و نقشه راه ثبت شد.
- قرارداد مشترک Codex و Claude Code تعریف شد.
- تحقیق Smartlaunch، SENET، ggLeap، Antamedia، QuickBooks و Xero ثبت شد.
- سیستم طراحی و بانک ایده‌های متمایزکننده اضافه شد.
- ممیزی read-only توسط Claude Code انجام و پس از بازبینی مدیر پروژه ثبت شد.
- شکاف‌های P0 شامل shift close، هزینه server-side و reconciliation مشخص شدند.
- Brain و ۲۲ commit قبلی تا `3fa6b95` روی GitHub منتشر شدند.
- task رسمی `P0 - Financial Trust` برای اجرای مرحله‌ای توسط Claude تعریف شد.
