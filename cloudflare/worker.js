// Cloudflare Worker: always-on planner reminder.
// Runs every minute via Cron Trigger (free, no credit card).
// Reads task times from Firestore (open read rules), sends Telegram when a task
// starts, and KEEPS re-sending every minute until you reply to the bot.
//
// Env (set as secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FIREBASE_PROJECT_ID
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
    return new Response('ok');
  },

  async fetch(request, env, ctx) {
    // Allows a manual test via browser: /ping
    const url = new URL(request.url);
    if (url.pathname === '/ping') {
      try {
        const out = await run(env);
        let beat = '(none)';
        try { await fsSet(env.FIREBASE_PROJECT_ID, 'planner-meta/heartbeat', { t: String(Date.now()) }); beat = 'ok'; }
        catch (e) { beat = 'ERR ' + e.message; }
        out.beat = beat;
        return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
      } catch (e) {
        return new Response('ERROR: ' + e.message, { status: 500 });
      }
    }
    return new Response('planner-reminder worker', { status: 200 });
  },
};

const DAYS = [
  { key: 'sun', label: 'الأحد' }, { key: 'mon', label: 'الإثنين' },
  { key: 'tue', label: 'الثلاثاء' }, { key: 'wed', label: 'الأربعاء' },
  { key: 'thu', label: 'الخميس' }, { key: 'fri', label: 'الجمعة' },
  { key: 'sat', label: 'السبت' },
];


function fsUrl(projectId, path) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

async function fsGet(projectId, path) {
  const r = await fetch(fsUrl(projectId, path));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS get ' + r.status);
  const j = await r.json();
  return (j && j.fields) ? plain(j.fields) : null;
}

async function fsSet(projectId, path, obj) {
  const r = await fetch(fsUrl(projectId, path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!r.ok && r.status !== 200) throw new Error('FS set ' + r.status);
  return true;
}

async function fsDel(projectId, path) {
  const r = await fetch(fsUrl(projectId, path), { method: 'DELETE' });
  if (!r.ok && r.status !== 404 && r.status !== 200) throw new Error('FS del ' + r.status);
  return true;
}

function plain(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.mapValue) out[k] = v.mapValue.fields ? plain(v.mapValue.fields) : {};
    else if (v.arrayValue) out[k] = (v.arrayValue.values || []).map((x) => {
      if (x.stringValue !== undefined) return x.stringValue;
      if (x.booleanValue !== undefined) return x.booleanValue;
      if (x.integerValue !== undefined) return Number(x.integerValue);
      if (x.mapValue) return x.mapValue.fields ? plain(x.mapValue.fields) : {};
      return null;
    });
  }
  return out;
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) f[k] = { arrayValue: { values: v.map((x) => {
      if (typeof x === 'string') return { stringValue: x };
      if (typeof x === 'boolean') return { booleanValue: x };
      if (typeof x === 'number') return { integerValue: String(x) };
      return { mapValue: { fields: toFields(x) } };
    }) } };
    else if (typeof v === 'object' && v !== null) f[k] = { mapValue: { fields: toFields(v) } };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else if (typeof v === 'number') f[k] = { integerValue: String(v) };
    else f[k] = { stringValue: String(v) };
  }
  return f;
}

function cairoParts(utcNow) {
  const m = utcNow.getUTCMonth();
  const winter = m <= 3 || m === 10 || m === 11;
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
  return { hhmm: `${hh}:${mm}`, dayKey: wd };
}

// تاريخ اليوم بتوقيت القاهرة بصيغة YYYY-MM-DD (نفس التي بتبعته الموقع لما ينشر الـ checks).
function cairoDateKey(utcNow) {
  const m = utcNow.getUTCMonth();
  const winter = m <= 3 || m === 10 || m === 11;
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

const CELLIMG = 'https://marwanvoltss.github.io/planner-app/celebrate.png';

// اللينكات اللي إنت بعتالها ليا — كل رابطة بترجّع صورة محددة (الصورة اللي "طلعت له").
// البوت يختار عشوائيًا من الصور دي كل ما ترد "تمام".
const USER_PINS_RAW = [
  'https://pin.it/3QEAerNNV',
  'https://pin.it/1pKXdoteS',
  'https://pin.it/2HuOfQAbm',
  'https://pin.it/3jVpVGex8',
  'https://pin.it/574rRLFed',
  'https://pin.it/2hOEVCAN3',
  'https://pin.it/2D7o6cOdD',
];
// الصور المباشرة للروابط (الأولى الواضحة في كل صفحه من صفحاتك).
const PIN_DIRECT = [
  'https://i.pinimg.com/736x/5c/2e/bc/5c2ebc660f46bd024d2d17d48db67ba8.jpg',
  'https://i.pinimg.com/736x/ed/1b/ec/ed1bec85d9bde294e457a6ff289f6cc2.jpg',
  'https://i.pinimg.com/736x/9e/6c/6d/9e6c6d25a6a8686708d2802638d01dcb.jpg',
  'https://i.pinimg.com/736x/14/cb/91/14cb91ae2b854434e2fdb8eb60ecb6e2.jpg',
  'https://i.pinimg.com/736x/39/d6/25/39d625f5e5c5cc7be804725f6d65b554.jpg',
  'https://i.pinimg.com/736x/d8/29/e3/d829e3a0c8290f7ffb0346e31fa630ee.jpg',
  'https://i.pinimg.com/736x/9a/33/51/9a3351cf356a85df23a73a93c70ff49b.jpg',
];

// كلمات ممنوعة تمامًا — أي صورة/رابط فيها واحدة من دول تُحجب (منع +18/محتوى ناشئ).
const NSFW = [
  'nsfw', 'adult', 'hotgirl', 'hot girl', 'porn', 'sexy', 'sextape', 'nude', 'naked',
  'onlyfans', '+18', 'leaked', 'bikini', 'lingerie', 'ass', 'boobs', 'tits', 'x18',
  'escort', 'camgirl',
];
function isNsfw(text) {
  const t = (text || '').toLowerCase();
  return NSFW.some((w) => t.includes(w));
}

// للحماية: نمنع فوريًا أي صورة ناشئة.
// pinCandidates() بترجع الصورة العشوائية الأولانية (اللي هندور بيها)، والباقي كاحتياطي لو الصورة ديه وقعت/مش متاحة.
let lastPinIdx = -1;
function pinCandidates() {
  const pool = PIN_DIRECT.filter((u) => !isNsfw(u));
  if (pool.length === 0) return [];
  let lead = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && lead === lastPinIdx) lead = (lead + 1) % pool.length;
  lastPinIdx = lead;
  const rest = pool.filter((_, i) => i !== lead);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [pool[lead], ...rest];
}

// فارق الدقائق بين وقت المهمة والساعة دلوقتي (0 = في موعدها بالضبط، موجب = متأخر).
function diffMinutes(startHHMM, nowHHMM) {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  return (nh * 60 + nm) - (sh * 60 + sm);
}

function dueText(hhmm, title, tagLabel, start) {
  return `<b>⏰ حان الآن موعد المهمة!</b>\n\n<b>المهمة:</b> ${title}\n<b>التصنيف:</b> ${tagLabel || 'مهمة'} | <b>الميعاد:</b> ${start}\n\nيلا بينا ابدأ فيها حالا، ورد عليا بأي كلمة عشان أعرف إنك انتبهت! 🎯`;
}

function resendText(hhmm, title, start) {
  const dm = diffMinutes(start, hhmm);
  return `<b>⏳ تنبيه متأخر بـ ${dm} دقيقة!</b>\n\nالساعة دلوقتي <b>${hhmm}</b> ومهمة <b>${title}</b> (اللى كانت الساعة <b>${start}</b>) لسه متبدتش!\n\nبلاش تسويف يا بطل، ابدأ فيها ورد عليا حالا عشان أوقف التنبيهات. 🛑`;
}

// احتفالي لما ترد أو تخلص مهمة — صورة + كلام تحفيزي، مع عدد المهام المتبقية.
function completionText(completedTitle, remaining, total) {
  if (total == null) {
    return `<b>🎉 عاش جداً يا وحش!</b>\n\nتم رصد الرد وتسجيل إتمام مهمة <b>${completedTitle}</b> بنجاح.\n\nباقي عندك <b>${Math.max(0, remaining)}</b> ${remaining === 1 ? 'مهمة' : 'مهام'} نقفل بيه يومنا، كمل طاقة وبطل كسل! 💪`;
  }
  if (remaining === 0) {
    return `<b>🎉 عاش جداً يا وحش!</b>\n\nتم رصد الرد وتسجيل إتمام مهمة <b>${completedTitle}</b> بنجاح.\n\nباقي عندك <b>0</b> مهام نقفل بيه يومنا، كمل طاقة وبطل كسل! 💪`;
  }
  const n = remaining;
  const plural = n === 1 ? 'مهمة واحدة' : (n === 2 ? 'مهمتين' : `${n} مهايم`);
  return `<b>🎉 عاش جداً يا وحش!</b>\n\nتم رصد الرد وتسجيل إتمام مهمة <b>${completedTitle}</b> بنجاح.\n\nباقي عندك <b>${plural}</b> نقفل بيه يومنا، كمل طاقة وبطل كسل! 💪`;
}

async function completion(env, chatId, completedTitle, remaining, total) {
  const text = completionText(completedTitle, remaining, total);
  // Try a few random pin images in order; always land on celebrate.png if all fail.
  const candidates = [...pinCandidates(), CELLIMG];
  for (const photo of candidates) {
    try {
      const res = await tg(env, 'sendPhoto', { chat_id: chatId, photo, caption: text, parse_mode: 'HTML' });
      if (res && res.ok) return; // delivered, done
    } catch (e) { console.log('pull-warn', e.message); }
  }
  try { await tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }); } catch (_) {}
}

async function run(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const chatId = env.TELEGRAM_CHAT_ID;
  const now = new Date();
  const { hhmm, dayKey } = cairoParts(now);
  const dayLabel = (DAYS.find((x) => x.key === dayKey) || {}).label || dayKey;

  // Reads use the open rules the app relies on (read allowed).
  let allSched = {};
  try { allSched = (await fsGet(projectId, 'planner-schedule/index'))?.all || {}; }
  catch (e) { console.log('sched-warn', e.message); }

  let pending = {};
  try { pending = (await fsGet(projectId, 'planner-meta/pending'))?.tasks || {}; }
  catch (e) { /* empty */ }

  let lastUpdateId = 0;
  try { lastUpdateId = (await fsGet(projectId, 'planner-meta/tg'))?.lastUpdateId || 0; }
  catch (e) { /* 0 */ }

  const tasks = (allSched[dayKey] || []).map((it) => ({ id: it.id, title: it.title, start: it.start }));
  const dueNow = tasks.filter((t) => t.start === hhmm);

  // ---- لو لقى مهمة جديدة متمّمة (تكتب "تمام" على المهمة في الموقع) بيهنّي وبيقول الباقي ----
  const dateKey = cairoDateKey(now);
  let checksToday = {};
  try { checksToday = (await fsGet(projectId, 'planner-meta/checks'))?.byDate?.[dateKey] || {}; }
  catch (e) { /* empty */ }
  const doneIds = Object.keys(checksToday || {}).filter((id) => checksToday[id]);
  let progress = {};
  try { progress = (await fsGet(projectId, 'planner-meta/progress')) || {}; }
  catch (e) { /* empty */ }

  if (progress.date !== dateKey) {
    // يوم جديد — نبدأ حساب من غير ما نهنّي على مهايم تمّت قبل كده.
    await fsSet(projectId, 'planner-meta/progress', { date: dateKey, done: doneIds }).catch(() => {});
  } else {
    const alreadyDone = progress.done || [];
    const newDone = doneIds.filter((id) => !alreadyDone.includes(id));
    if (newDone.length > 0) {
      const total = tasks.length;
      const remaining = Math.max(0, total - doneIds.length);
      const doneTask = tasks.find((x) => x.id === newDone[0]);
      const doneTitle = doneTask?.title || 'المهمة';
      await completion(env, chatId, doneTitle, remaining, total); // تهنيئة + صورة عشوائية + الباقي
      await fsSet(projectId, 'planner-meta/progress', { date: dateKey, done: doneIds }).catch(() => {});
    } else if (doneIds.length !== alreadyDone.length) {
      // حدّث بس من غير ما نهنّي (حالة إلغاء إتمام).
      await fsSet(projectId, 'planner-meta/progress', { date: dateKey, done: doneIds }).catch(() => {});
    }
  }

  // Acknowledge: any message you sent to the bot stops all pending reminders.
  const upd = await tg(env, 'getUpdates', { offset: lastUpdateId + 1, timeout: 0, allowed_updates: ['message'] });
  const updates = (upd.ok && upd.result) ? upd.result : [];
  const newLast = updates.length ? Math.max(...updates.map((u) => u.update_id)) : lastUpdateId;
  let pendingCopy = { ...pending };

  if (updates.length > 0) {
    // Student replied → celebrate with the most recently-pending task + remaining count.
    const completedTask = pendingCopy[Object.keys(pendingCopy)[0]] || null;
    const completedTitle = completedTask?.title || (tasks.length ? tasks[0].title : 'المهمة');
    const rim = Math.max(0, tasks.length - doneIds.length);
    await completion(env, chatId, completedTitle, rim, tasks.length);
    pendingCopy = {};
  }

  let reSent = 0;

  for (const t of dueNow) {
    if (pendingCopy[t.id]) continue;
    pendingCopy[t.id] = { start: t.start, title: t.title, firstSent: Date.now(), idx: 0 };
    const text = dueText(hhmm, t.title, null, t.start);
    const res = await tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (res.ok) reSent++;
  }

  for (const [id, t] of Object.entries(pendingCopy)) {
    if (!pending[id]) continue;
    const text = resendText(hhmm, t.title, t.start);
    const res = await tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (res.ok) reSent++;
  }

  if (Object.keys(pendingCopy).length === 0) await fsDel(projectId, 'planner-meta/pending').catch(() => {});
  else await fsSet(projectId, 'planner-meta/pending', { tasks: pendingCopy }).catch(() => {});

  if (newLast > lastUpdateId) {
    await fsSet(projectId, 'planner-meta/tg', { lastUpdateId: newLast }).catch(() => {});
  }

  return { hhmm, dayKey, due: dueNow.length, resent: reSent, pending: Object.keys(pendingCopy).length };
}