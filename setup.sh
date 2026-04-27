#!/bin/bash
echo "🎮 نصب MuteGame System..."

echo ""
echo "📦 نصب پکیج‌های سرور..."
cd server && npm install

echo ""
echo "📦 نصب پکیج‌های پنل ادمین..."
cd ../admin && npm install

echo ""
echo "📦 نصب پکیج‌های کلاینت..."
cd ../client && npm install
cd renderer && npm install 2>/dev/null; cd ..

echo ""
echo "✅ نصب کامل شد!"
echo ""
echo "▶️  شروع سرور: cd server && npm start"
echo "▶️  شروع پنل ادمین: cd admin && npm run dev"
echo "▶️  شروع کلاینت: cd client && npm start"
echo ""
echo "🔐 ادمین پیش‌فرض: admin / admin123"
