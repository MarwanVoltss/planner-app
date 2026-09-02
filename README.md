# المخطط الأسبوعي — Weekly Study Planner PWA

تطبيق جدول أسبوعي للطالب: شيتشكليست بتقدم حي، تعديل المواعيد، منبه صوتي + إشعارات، وPWA للهاتف. عربي RTL، بـReact 19 + Vite + Tailwind.

مباشرة: **https://marwanvoltss.github.io/planner-app/**

## اللي محتاج تعمله مرة واحدة عشان push notifications تشتغل

المنبه الحالي بيشتغل من المتصفح (لازم الموقع مفتوح). علشان المنبه يوصلك **حتى والموقع مقفول** — محتاج تعبّي 3 قيم:

### 1) تعبئة الـ config في `src/firebase/config.js`
1. افتح https://console.firebase.google.com واعمل **Add project** (قفل Google Analytics).
2. من **Project settings ⚙️ → General → Your apps → `</>` Web**.
3. سجّل باسم `planner` وخُذ نسخة `firebaseConfig` ولصّق القيم في `src/firebase/config.js`.
4. من **Project settings → Cloud Messaging** انسخ **Key pair** وحطّه في `VAPID_KEY`.

### 2) تسجيل المفتاح السري في GitHub
من صفحة الريبو: **Settings → Secrets and variables → Actions → New repository secret**:
- `FCM_SERVER_KEY`: من **Firebase → Project settings → Cloud Messaging → "Cloud Messaging API (Legacy) server key"**.
- `FCM_DEVICE_TOKEN`: هتجيبه بعد ما تطبّق الصفحة وتدوس **تفعيل**، هيظهر زرار **نسخ الرمز** — انسخه ولصّقه هنا (لو أكثر من جهاز حطهم مفصولين بفاصلة).

### 3) تشغيل المنبه
- افتح الموقع وارجع للدورة الأولى ودوس **تفعيل** عند شريط الإشعارات.
- بعد الحفظ، ارفع التعديلات `git push` (هتتشغل على GitHub Pages تلقائيًا).
- الـ cron يشتغل كل دقيقة ويبعت push وقت بداية كل مهمة — حتى والموقع مقفول.

## التطوير محليًا
```bash
npm install
npm run dev      # http://localhost:5173
npm run preview  # اختبار build جاهز (4173)
npm run build
```

## الـ workflow (push-alarm)
`.github/workflows/push-alarm.yml` يشغّل `cloud/send-push.mjs` كل دقيقة؛ بيقرأ نفس `src/lib/schedule.js` ويبعت push بأوقات المهام (بتوقيت القاهرة).