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
      const out = await run(env);
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
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
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
    else if (v.arrayValue) out[k] = (v.arrayValue.values || []).map((x) => plain(x.mapValue.fields));
  }
  return out;
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) f[k] = { arrayValue: { values: v.map((x) => ({ mapValue: { fields: toFields(x) } })) } };
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
  const gb = d.getUTCDay();
  return { hhmm: `${hh}:${mm}`, dayKey: DAY_ORDER[(gb + 1) % 7] };
}

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
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

  // Acknowledge: any message you sent to the bot stops all pending reminders.
  const upd = await tg(env, 'getUpdates', { offset: lastUpdateId + 1, timeout: 0, allowed_updates: ['message'] });
  const updates = (upd.ok && upd.result) ? upd.result : [];
  const newLast = updates.length ? Math.max(...updates.map((u) => u.update_id)) : lastUpdateId;
  let pendingCopy = { ...pending };

  if (updates.length > 0) pendingCopy = {};

  for (const t of dueNow) {
    if (pendingCopy[t.id]) continue;
    pendingCopy[t.id] = { start: t.start, title: t.title, firstSent: Date.now() };
    const text = `<b>⏰ ${t.title}</b>\n${dayLabel} · ${t.start}\n\n<i>رد على البوت بأي كلمة لإيقاف تذكير هذه المهمة.</i>`;
    const res = await tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    console.log('sent', t.id, res.ok);
  }

  let reSent = 0;
  for (const [id, t] of Object.entries(pendingCopy)) {
    const text = `<b>⏰ ${t.title}</b>\n${dayLabel} · ${t.start}\n\n<i>لسه مستنية رجوعك! رد على البوت لإيقافه.</i>`;
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