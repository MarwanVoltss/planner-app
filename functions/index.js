// Always-on reminder, every minute, forever (Google Cloud Scheduler + Functions).
// Unlike GitHub Actions free cron (which does not fire), this runs reliably.
//
// Task times come from a Firestore `planner-schedule` doc that your web app
// publishes (schedule.js + your edits merged). So the bot honors exactly what
// you see in the app.
//
// Behavior:
//   - When a task's start time == current Cairo minute -> send Telegram msg,
//     add it to a "pending" set.
//   - Re-sends the message every minute while pending.
//   - When you reply to the bot (any message), all pending reminders stop.
//
// Deploy (one time):
//   1. Firebase console -> Upgrade to Blaze (free within quotas).
//   2. firebase login
//   3. firebase deploy --only functions
const { onSchedule } = require('firebase-functions/v2/scheduler');
const adminInit = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

adminInit.initializeApp();
const db = getFirestore();

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function cairoParts(utcNow) {
  const m = utcNow.getUTCMonth();
  const winter = m <= 3 || m === 10 || m === 11;
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const gb = d.getUTCDay();
  return { hhmm: `${hh}:${mm}`, dayKey: DAY_ORDER[(gb + 1) % 7] };
}

// فارق الدقائق بين وقت المهمة والساعة دلوقتي (0 = في موعدها بالضبط، موجب = متأخر).
function diffMinutes(startHHMM, nowHHMM) {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  return (nh * 60 + nm) - (sh * 60 + sm);
}

// صورة احتفالية متاحة في الريبو (تُرفق برسائل التهنئة).
const PIN_IMAGES = ['https://marwanvoltss.github.io/planner-app/celebrate.png'];

// يرسل رسالة تهنئة مع صورة (sendPhoto) ، ويرجع للنص فقط لو فشلت الصورة.
async function sendCelebration(chatId, text) {
  for (const photo of PIN_IMAGES) {
    try {
      const res = await telegram('sendPhoto', { chat_id: chatId, photo, caption: text, parse_mode: 'HTML' });
      if (res && res.ok) return true;
    } catch (e) { /* try next */ }
  }
  try {
    const res = await telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    return !!(res && res.ok);
  } catch (_) { return false; }
}

async function getSchedule() {
  try {
    const snap = await db.collection('planner-schedule').doc('index').get();
    return (snap.exists && snap.data() && snap.data().all) || {};
  } catch (e) {
    console.log('schedule-load-warn', e.message);
    return {};
  }
}

async function getPending() {
  try {
    const snap = await db.collection('planner-meta').doc('pending').get();
    return (snap.exists && snap.data() && snap.data().tasks) || {};
  } catch (e) { return {}; }
}

async function getLastUpdateId() {
  try {
    const snap = await db.collection('planner-meta').doc('tg').get();
    return (snap.exists && snap.data().lastUpdateId) || 0;
  } catch (e) { return 0; }
}

async function persistPending(tasks) {
  const ref = db.collection('planner-meta').doc('pending');
  if (Object.keys(tasks).length === 0) {
    try { await ref.delete(); } catch (e) { /* ignore */ }
  } else {
    await ref.set({ tasks });
  }
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

exports.remind = onSchedule({ schedule: '* * * * *', timeZone: 'Africa/Cairo' }, async () => {
  const now = new Date();
  const { hhmm, dayKey } = cairoParts(now);
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const [allSched, pending, lastUpdateId] = await Promise.all([
    getSchedule(), getPending(), getLastUpdateId(),
  ]);

  const tasks = (allSched[dayKey] || []).map((it) => ({
    id: it.id, title: it.title, start: it.start,
  }));

  const dueNow = tasks.filter((t) => t.start === hhmm);

  // Acknowledge: any message you sent to the bot stops ALL pending reminders.
  const upd = await telegram('getUpdates', { offset: lastUpdateId + 1, timeout: 0, allowed_updates: ['message'] });
  const updates = (upd.ok && upd.result) ? upd.result : [];
  const newLast = updates.length ? Math.max(...updates.map((u) => u.update_id)) : lastUpdateId;
  let pendingCopy = { ...pending };

  if (updates.length > 0) {
    // Student replied → celebrate with remaining count, then clear all pending.
    const completedTask = pendingCopy[Object.keys(pendingCopy)[0]] || null;
    const completedTitle = completedTask?.title || (tasks.length ? tasks[0].title : 'المهمة');
    const remainingCount = Math.max(0, tasks.length - 1);
    const cText = `<b>🎉 عاش جداً يا وحش!</b>\n\nتم رصد الرد وتسجيل إتمام مهمة <b>${completedTitle}</b> بنجاح.\n\nباقي عندك <b>${remainingCount}</b> ${remainingCount === 1 ? 'مهمة' : 'مهام'} نقفل بيه يومنا، كمل طاقة وبطل كسل! 💪`;
    await sendCelebration(chatId, cText);
    pendingCopy = {};
    console.log('REPLIED: celebrated + cleared pending');
  }

  for (const t of dueNow) {
    if (pendingCopy[t.id]) continue;
    pendingCopy[t.id] = { start: t.start, title: t.title, firstSent: Date.now() };
    const text = `<b>⏰ حان الآن موعد المهمة!</b>\n\n<b>المهمة:</b> ${t.title}\n<b>التصنيف:</b> مهمة | <b>الميعاد:</b> ${t.start}\n\nيلا بينا ابدأ فيها حالا، ورد عليا بأي كلمة عشان أعرف إنك انتبهت! 🎯`;
    const res = await telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    console.log(`sent ${t.id}:`, res.ok);
  }

  let reSent = 0;
  for (const t of Object.values(pendingCopy)) {
    const dm = diffMinutes(t.start, hhmm);
    const text = `<b>⏳ تنبيه متأخر بـ ${dm} دقيقة!</b>\n\nالساعة دلوقتي <b>${hhmm}</b> ومهمة <b>${t.title}</b> (اللى كانت الساعة <b>${t.start}</b>) لسه متبدتش!\n\nبلاش تسويف يا بطل، ابدأ فيها ورد عليا حالا عشان أوقف التنبيهات. 🛑`;
    const res = await telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (res.ok) reSent++;
  }

  await persistPending(pendingCopy);
  if (newLast > lastUpdateId) {
    await db.collection('planner-meta').doc('tg').set({ lastUpdateId: newLast }).catch(() => {});
  }

  console.log(`${hhmm}: due=${dueNow.length} resent=${reSent} pending=${Object.keys(pendingCopy).length}`);
  return null;
});