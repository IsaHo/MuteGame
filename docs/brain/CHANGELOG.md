# Brain Changelog

## 2026-07-26 (financial reconciliation)

- گزارش مغایرت، مانده عملیاتی کاربران را با آخرین مانده append-only ledger مقایسه می‌کند.
- کاربران بدون سابقه ledger به‌عنوان baseline فقط‌خواندنی نمایش داده می‌شوند و drift محسوب نمی‌شوند.
- اصلاح فقط مانده cache را به ledger برمی‌گرداند؛ عدد هدف دلخواه از اپراتور پذیرفته نمی‌شود.
- permission مستقل `users.reconcile`، دلیل ۱۰ تا ۵۰۰ کاراکتر، optimistic concurrency و idempotency الزامی است.
- `reconciliation_log` با triggerهای append-only و boot verification اضافه شد.
- ledger event، reconciliation log و audit اتمیک هستند؛ Socket sync پس از commit انجام می‌شود.
- تب «تطبیق حساب» با خلاصه، فیلتر اختلاف، drilldown ledger و پنجره اصلاح به Qt Admin اضافه شد.
- ۶۴ تست server-side پاس و Qt Admin بدون خطای build ساخته شد.

## 2026-07-25 (cashier shifts)

- شیفت صندوق server-side با تضمین فقط یک شیفت باز و ثبت audit اتمیک اضافه شد.
- شارژ کاربر، پرداخت بدهی، سفارش تأییدشده و هزینه به شیفت جاری متصل می‌شوند؛ عملیات بدون شیفت متوقف نمی‌شود و با `shift_id=NULL` باقی می‌ماند.
- موجودی مورد انتظار از موجودی اول + ورودی نقدی - هزینه نقدی محاسبه می‌شود؛ کارت، انتقال و کیف پول جدا گزارش می‌شوند.
- مبلغ واقعی پرداخت شارژ جدا از bonus در ledger ثبت می‌شود تا هدیه به‌اشتباه پول صندوق محسوب نشود.
- snapshot جزئیات صندوق هنگام بستن ذخیره می‌شود و بستن تکراری idempotent است.
- پنل حسابداری تب شیفت، پیش‌نمایش بستن، شمارش صندوق، اختلاف و تاریخچه دارد.
- انتخاب روش پرداخت به هزینه، شارژ و پرداخت بدهی اضافه شد.
- ۴۸ تست server-side پاس و Qt Admin بدون خطای build ساخته شد.

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
