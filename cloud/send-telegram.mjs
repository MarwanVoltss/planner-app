// GitHub Actions cron: sends a Telegram message when a task starts, and KEEPS
// re-sending every minute until the student replies to the bot ("يفضل يبعت حتى
// ما ارد على البوت").
//
// Reads task times from a shared Firestore store, so any custom edit made in the
// web app locally is honored here (the app pushes edits to Firestore on change).
//
// Secrets (repo Settings -> Secrets -> Actions):
//   TELEGRAM_BOT_TOKEN  -> token from @BotFather.
//   TELEGRAM_CHAT_ID    -> your numeric chat id.
//   GOOGLE_SERVICE_ACCOUNT -> the full service-account JSON for the Firebase
//                             project (used to read Firestore + mint OAuth).
import { WEEK, DAYS, DAY_ORDER, TAGS } from '../src/lib/schedule.js';
import { createSign } from 'node:crypto';

const FS_PATH = 'planner-edits/index';

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ---- OAuth via Firebase service account (RS256 JWT) ----
async function oauthToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const h = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256'); signer.update(h + '.' + c);
  const jwt = h + '.' + c + '.' + base64url(signer.sign(sa.private_key));
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('OAuth failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// ---- Firestore REST helpers ----
function fsUrl(projectId, path) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

async function fsGet(token, projectId, path) {
  const r = await fetch(fsUrl(projectId, path), { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS get failed ' + r.status + ': ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return j.fields || null;
}

async function fsSet(token, projectId, path, fields) {
  const body = { fields };
  const r = await fetch(fsUrl(projectId, path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 200) throw new Error('FS set failed ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return true;
}

async function fsDelete(token, projectId, path) {
  const r = await fetch(fsUrl(projectId, path), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok && r.status !== 200 && r.status !== 404) throw new Error('FS delete failed ' + r.status);
  return true;
}

function toPlain(fields) {
  if (!fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.mapValue && v.mapValue.fields) out[k] = toPlain(v.mapValue.fields);
    else if (v.arrayValue) out[k] = (v.arrayValue.values || []).map(toPlain);
  }
  return out;
}

function plainToFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null) fields[k] = { mapValue: { fields: plainToFields(v) } };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

// ---- Cairo time (school-year sane offsets) ----
function cairoParts(utcNow) {
  const m = utcNow.getUTCMonth();
  const winter = m <= 3 || m === 10 || m === 11;
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const gb = d.getUTCDay();
  return { hhmm: `${hh}:${mm}`, dayKey: DAY_ORDER[(gb + 1) % 7], stamp: d.toISOString() };
}

// ---- Telegram ----
async function tg(botToken, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

const now = new Date();
const { hhmm, dayKey } = cairoParts(now);
const dayLabel = (DAYS.find((d) => d.key === dayKey) || {}).label || dayKey;

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
if (!botToken || !chatId || !saJson) {
  console.error('SKIP: need TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and GOOGLE_SERVICE_ACCOUNT');
  process.exit(0);
}

async function main() {
  const sa = JSON.parse(saJson);
  const token = await oauthToken(sa);

  // 1) Read server-side edits (custom times from the web app).
  let edits = {};
  try { edits = toPlain(await fsGet(token, sa.project_id, FS_PATH))?.all || {}; }
  catch (e) { console.log('EDIT-LOAD-WARN: ' + e.message); }

  // 2) Build the day's tasks: defaults overridden by edits.
  const base = WEEK[dayKey] || [];
  const tasks = base.map((it) => {
    const e = edits[it.id] || {};
    return {
      id: it.id,
      title: e.title || it.title,
      start: e.start || it.start,
      end: e.end ?? it.end,
      tag: it.tag,
    };
  });

  // 3) Which task is starting right now this minute (or is pending)?
  const dueNow = tasks.filter((t) => t.start === hhmm);

  // 4) Pending = tasks we're repeating until the student replies.
  let pending = {};
  try { pending = toPlain(await fsGet(token, sa.project_id, 'planner-meta/pending'))?.tasks || {}; }
  catch (e) { /* keep empty */ }

  // Detect a fresh user reply: any Telegram update since the last run acks ALL
  // currently-pending tasks (the student "replied" to the bot).
  let lastUpdateId = 0;
  try { lastUpdateId = toPlain(await fsGet(token, sa.project_id, 'planner-meta/tg'))?.lastUpdateId || 0; }
  catch (e) { /* keep 0 */ }

  const upd = await tg(botToken, 'getUpdates', { offset: lastUpdateId + 1, timeout: 0, allowed_updates: ['message'] });
  const updates = (upd.ok && upd.result) ? upd.result : [];
  const newLast = updates.length ? Math.max(...updates.map((u) => u.update_id)) : lastUpdateId;

  async function persistPending() {
    if (Object.keys(pending).length === 0) {
      await fsDelete(token, sa.project_id, 'planner-meta/pending').catch(() => {});
    } else {
      await fsSet(token, sa.project_id, 'planner-meta/pending', { tasks: pending }).catch(() => {});
    }
  }

  if (updates.length > 0) {
    // Student replied → clear all pending so we stop repeating.
    pending = {};
    await persistPending();
    console.log(`REPLIED: user sent ${updates.length} message(s) — cleared pending reminders.`);
  }
  if (newLast > lastUpdateId) {
    await fsSet(token, sa.project_id, 'planner-meta/tg', { lastUpdateId: newLast }).catch(() => {});
  }

  // 5) Add newly-due tasks to pending and send them.
  let sent = 0;
  for (const t of dueNow) {
    if (pending[t.id]) continue; // already reminded for this task today
    pending[t.id] = { start: t.start, title: t.title, firstSent: Date.now() };
    const tag = TAGS?.[t.tag]?.label;
    const text = `<b>⏰ ${t.title}</b>\n${dayLabel} · ${t.start}` + (tag ? ` · ${tag}` : '') + `\n\n<i>رد على البوت بأي كلمة لإيقاف تذكير هذه المهمة.</i>`;
    const res = await tg(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    console.log(`-> ${t.id} ${res.ok ? 'sent' : 'FAIL ' + JSON.stringify(res).slice(0, 120)}`);
    sent++;
  }

  // 6) Re-send pending tasks each minute (repeat until acked).
  let reSent = 0;
  for (const [id, t] of Object.entries(pending)) {
    const tag = TAGS?.[tasks.find((x) => x.id === id)?.tag]?.label;
    const text = `<b>⏰ ${t.title}</b>\n${dayLabel} · ${t.start}` + (tag ? ` · ${tag}` : '') + `\n\n<i>لسه مستنية رجوعك! رد على البوت لإيقافه.</i>`;
    const res = await tg(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    if (res.ok) reSent++;
  }

  await persistPending();

  if (sent === 0 && reSent === 0) console.log(`No task at ${hhmm} (${dayLabel}); pending=${Object.keys(pending).length}.`);
  else console.log(`${hhmm}: sent ${sent} new, re-sent ${reSent} pending.`);
}

main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); }).finally(() => process.exit(0));
