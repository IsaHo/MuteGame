# P0 - Financial Trust

مالک اجرا: Claude Code  
مالک تصمیم و پذیرش: مدیر پروژه  
وضعیت: در حال اجرا

## هدف

تبدیل حسابداری از ترکیب ledger مرکزی و هزینه محلی به یک سیستم server-side قابل backup، audit و بستن شیفت.

## Scope

### 1. Expenses

- [x] جدول server-side `expenses` با مبلغ صحیح ریالی، روش پرداخت، اطلاعات ادمین و soft-void.
- [x] ثبت، ویرایش، فهرست و ابطال با permission مالی و audit اتمیک.
- [x] migration یک‌باره QSettings با idempotency و حفظ نسخه محلی تا تأیید کامل سرور.
- [x] اتصال AccountingPage به API مرکزی.
- [x] ۱۴ تست خودکار برای اعتبارسنجی، idempotency، import اتمیک و audit.
- [ ] اتصال هزینه‌ها به `shift_id` پس از ساخته‌شدن زیرسیستم شیفت.

### 2. Shifts

- [x] جدول `shifts` با اپراتور، موجودی اول، موجودی مورد انتظار، شمارش نهایی، اختلاف و snapshot جزئیات.
- [x] تضمین دیتابیسی فقط یک شیفت باز.
- [x] اتصال شارژ، پرداخت بدهی، سفارش تأییدشده و هزینه به شیفت جاری.
- [x] تفکیک نقد، کارت، انتقال و کیف پول در گزارش شیفت.
- [x] پیش‌نمایش بستن و ثبت نهایی idempotent با audit اتمیک.
- [x] رابط ساده بازکردن، بستن و تاریخچه شیفت در AccountingPage.
- [x] ۴۸ تست خودکار مالی و شیفت در مجموع.

### 3. Reconciliation

- [x] گزارش read-only اختلاف `users` و آخرین مانده ledger.
- [x] تفکیک وضعیت سالم، اختلاف و baseline قدیمی.
- [x] اصلاح فقط با `users.reconcile`، دلیل اجباری و optimistic concurrency.
- [x] idempotency و fingerprint درخواست برای جلوگیری از اصلاح تکراری.
- [x] ثبت رویداد جبرانی ledger، reconciliation log و audit در یک تراکنش.
- [x] همگام‌سازی کلاینت متصل فقط پس از commit موفق.
- [x] تب فارسی تطبیق حساب و پنجره بررسی/اصلاح در Qt Admin.

### 4. Tests

- expense CRUD و backup/restore.
- open/close shift و race.
- payment method totals.
- `limit_time` در tick، logout و recovery.
- crash بین tickها بدون double charge.

سه بخش هزینه‌ها، شیفت و reconciliation تکمیل شده‌اند. موارد باقی‌مانده این P0:
تست‌های billing مربوط به `limit_time`، logout/recovery و crash بین tickها.

## خارج از Scope

- multi-location cloud.
- اتصال بانکی.
- مالیات و فاکتور رسمی.
- بازطراحی کامل UI.

## دستور شروع برای Claude

```text
Brain و گزارش ممیزی را بخوان. ابتدا فقط طراحی schema، migration، endpoint contracts
و test matrix را ارائه کن. تا قبل از تأیید مدیر پروژه کد نزن. سپس کار را به PRهای
کوچک تقسیم کن: expenses، shifts، reconciliation، Qt migration.
```
