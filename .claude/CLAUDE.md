# MuteGame Claude Code Instructions

قبل از هر تغییر این فایل‌ها را بخوان:

1. `PROJECT_BRAIN.md`
2. `docs/brain/02 - Current State.md`
3. `docs/brain/06 - Agent Operating Protocol.md`
4. سند دامنه مرتبط با task

قواعد:

- Qt (`qt/admin`, `qt/client`) مسیر فعال محصول است؛ React/Electron legacy را بدون درخواست صریح گسترش نده.
- server منبع حقیقت نشست و پول است.
- هیچ تغییر مالی بدون ledger، transaction، idempotency و test.
- تغییرات کاربر را revert نکن.
- بعد از هر تغییر، سند مرتبط و `docs/brain/CHANGELOG.md` را به‌روزرسانی کن.
- گزارش پایان را با قالب موجود در Agent Operating Protocol ارائه کن.
