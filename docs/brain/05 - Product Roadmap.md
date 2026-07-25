# نقشه راه

## P0 - اعتماد مالی و نشست

- [ ] reconciliation خودکار ledger و balances
- [ ] A/R aging و statement کاربر
- [ ] صندوق و بستن شیفت
- [ ] idempotency برای تمام mutationهای مالی
- [ ] تست قطع شبکه، crash و خاموشی در حین نشست
- [ ] release manifest و restore drill

## P1 - Floor Operations

- [ ] health score هر PC
- [ ] آخرین heartbeat، latency و نسخه client
- [ ] صف اقدام‌های remote با delivery status
- [ ] bulk actions و گروه‌های PC
- [ ] اعلان actionable برای سفارش، زمان کم و خرابی

## P2 - Client Experience

- [ ] home قابل شخصی‌سازی
- [ ] recently played و favorites
- [ ] search سریع و پوسترهای استاندارد
- [ ] وضعیت download/update بازی
- [ ] اعلان کم‌مزاحمت در حالت fullscreen

## P3 - رشد درآمد

- [ ] پکیج‌های زمان و happy hour
- [ ] VIP station pricing
- [ ] loyalty و referral
- [ ] tournament/event booking
- [ ] پیشنهاد شاپ براساس زمان و بازی

## P4 - مقیاس

- [ ] multi-location
- [ ] console/TV station
- [ ] cloud observability اختیاری
- [ ] API integration و گزارش مالک

## Definition of Done

- کد، تست، migration و rollback.
- update مستند مرتبط و `CHANGELOG.md`.
- تست سناریوی واقعی Windows.
- عدم اختلاف ledger/reconciliation.
- screenshot یا ویدیوی QA برای تغییر UI.
