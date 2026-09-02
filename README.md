# المخطط الأسبوعي — Weekly Study Planner PWA

تطبيق جدول أسبوعي للطالب: شيتشكليست بتقدم حي، تعديل المواعيد، تخصيص الوجه (الثيم)، عربي/إنجليزي، وPWA للهاتف. عربي RTL، بـ React 19 + Vite + Tailwind.

مباشرة: **https://marwanvoltss.github.io/planner-app/**

## الـ site فصل تمامًا عن المنبه
الـ site بقى **صامت** (من غير أجراس ولا إشعارات داخل المتصفح). التذكير الوحيد هوا **بوت تيليجرام** اللي بيبعت رسالة لموبايلك وقت بداية كل مهمة — وبيشتغل حتى والموقع مقفول أو المتصفح مقفول، لأنو بيشتغل على خوادم GitHub كل دقيقة.

## إعداد بوت التليجرام (خطوتك الوحيدة)
1. افتح تيليجرام وابحث عن **@BotFather** → ابعت `/newbot` → اسم + username ينتهي بـ `bot` → هيبعتلك **Token**.
2. افتح محادثة مع بوتك وابعت أي حرف، ثم افتح `https://api.telegram.org/bot<Token>/getUpdates` → خُذ رقم **chat → id**.
3. من صفحة الريبو: **Settings → Secrets and variables → Actions → New repository secret**:
   - `TELEGRAM_BOT_TOKEN`: التوكن من BotFather.
   - `TELEGRAM_CHAT_ID`: رقم الـ chat (لو أكثر من جهاز حطهم مفصولين بفاصلة؟ — تيليجرام بوت رسالته بيوصل لكل اللي فتحوه؛ غيير مثقافش هنا).
4. جريان `telegram-alarm` بيبعت رسالة وقت بداية كل مهمة، والاختبار اللي بيعمل رسالة تجريبية فورًا: من **Actions → telegram-alarm → Run workflow**.

## ميزات الواجهة
- **الوجه (الثيم):** زرار 🎨 في الهيدر → اختار لون (بنفسجي/سماوي/وردي/زمردي/كهرماني).
- **اللغة:** عربي 🔁 English → تتبدل كل نصوص الواجهة والاتجاه RTL/LTR. الحفظ تلقائي في المتصفح.

## التطوير محليًا
```bash
npm install
npm run dev      # http://localhost:5173
npm run preview  # اختبار build جاهز (4173)
npm run build
```

## الـ workflow (telegram-alarm)
`.github/workflows/telegram-alarm.yml` يشغّل `cloud/send-telegram.mjs` كل دقيقة؛ بيقرأ نفس `src/lib/schedule.js` وبيبعت رسالة تيليجرام بمهام الوقت الحالي (بتوقيت القاهرة).