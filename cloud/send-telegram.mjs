// GitHub Actions cron: sends a Telegram message when a task in the weekly
// schedule starts — works even when the browser/device tab is fully closed,
// because it runs entirely on GitHub's servers and delivers through Telegram.
//
// Secrets required in the GitHub repo (Settings -> Secrets -> Actions):
//   TELEGRAM_BOT_TOKEN -> the token @BotFather gives you when you create the bot.
//   TELEGRAM_CHAT_ID   -> your numeric chat id (see note below on how to find it).
//
// Same schedule source and same Cairo-time logic as the web app.
import { WEEK, DAYS, DAY_ORDER, TAGS } from '../src/lib/schedule.js';

// Cairo offset: +2 in winter (Oct–Mar), +3 otherwise (approx. school-year sane).
function cairoHourMin(utcNow) {
  const m = utcNow.getUTCMonth(); // 0=Jan
  const winter = m <= 3 || m === 10 || m === 11;
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function cairoDayIndex(utcNow) {
  const d = new Date(utcNow.getTime() + 2 * 3600 * 1000);
  const gb = d.getUTCDay();
  return (gb + 1) % 7; // 0=Sat ... 6=Fri
}

async function sendTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return false;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const j = await r.json();
  console.log(`-> Telegram ${r.status}: ${JSON.stringify(j).slice(0, 140)}`);
  return j.ok === true;
}

const now = new Date();
const cairoNow = cairoHourMin(now);
const dayIdx = cairoDayIndex(now);
const key = DAY_ORDER[dayIdx];
const items = WEEK[key] || [];
const due = items.filter((it) => it.start === cairoNow);
const dayName = (DAYS.find((d) => d.key === key) || {}).label || key;

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!botToken) { console.error('SKIP: TELEGRAM_BOT_TOKEN secret not set'); process.exit(0); }
if (!chatId) { console.error('SKIP: TELEGRAM_CHAT_ID secret not set'); process.exit(0); }

// Manual verification: set TELEGRAM_TEST=1 (e.g. via workflow_dispatch or CLI)
// to send a test message immediately, independent of the schedule minute.
if (process.env.TELEGRAM_TEST === '1') {
  await sendTelegram(botToken, chatId, '<b>✅ اختبار بوت المخطط</b>\nالبوت شغال — هيوصلوك رسائل المواعيد من دلوقتي. 🎉');
  process.exit(0);
}

if (due.length === 0) {
  console.log(`No task at ${cairoNow} (${dayName}).`);
  process.exit(0);
}

for (const it of due) {
  const tag = TAGS?.[it.tag]?.label;
  const title = `<b>⏰ ${it.title}</b>`;
  const meta = `${dayName} · ${it.start}` + (tag ? ` · ${tag}` : '');
  const text = `${title}\n${meta}`;
  console.log(`DUE ${cairoNow}: ${it.title}`);
  await sendTelegram(botToken, chatId, text);
}
process.exit(0);