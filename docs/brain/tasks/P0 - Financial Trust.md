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

- `shifts`: opened_at/by، opening_cash، closed_at/by، counted_cash، expected_cash، variance، status.
- فقط یک shift باز در هر location.
- mutationهای نقدی به shift باز reference شوند.
- close preview قبل از commit نهایی.

### 3. Reconciliation

- report read-only اختلاف `users` و ledger.
- عملیات اصلاح فقط با permission ویژه و reason اجباری.
- هر اصلاح ledger event و audit مستقل.

### 4. Tests

- expense CRUD و backup/restore.
- open/close shift و race.
- payment method totals.
- `limit_time` در tick، logout و recovery.
- crash بین tickها بدون double charge.

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
