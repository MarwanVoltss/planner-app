// GitHub Actions cron: sends an FCM push when a task starts (even if the
// website is closed). Reads the SAME schedule as the app.
//
// Secrets required in the GitHub repo:
//   FCM_SERVER_KEY  -> Firebase Console > Cloud Messaging > "Cloud Messaging API"
//   FCM_DEVICE_TOKEN-> paste the token shown in the app's "نسخ الرمز" button.
//
// The schedule is authored in LOCAL Cairo time (UTC+2 / UTC+3). We convert the
// job's UTC "now" to Cairo and compare against each item.start (24h HH:MM).
import { WEEK, DAYS, DAY_ORDER, TAGS } from '../src/lib/schedule.js';

// Cairo offset: +2 when no DST (Egypt observed DST occasionally; default +2).
function cairoHourMin(utcNow) {
  // Rough: Jan..Apr (winter) +2, else +3. Good enough for a school planner.
  const m = utcNow.getUTCMonth(); // 0=Jan
  const winter = m <= 3 || m === 10 || m === 11; // Nov/Dec/Jan/Feb/Mar/Oct -> +2
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Map a Cairo day-of-week to our Saturday-first index.
function cairoDayIndex(utcNow) {
  const offset = 2; // for weekday only the +2/+3 rarely crosses a day; ignore edge
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  // getUTCDay(): 0 Sun..6 Sat -> our index (Sat) must be first: idx=(gb+1)%7 has Sat=6->0
  const gb = d.getUTCDay();
  return (gb + 1) % 7; // 0=Sat, 1=Sun ... 6=Fri
}

const now = new Date();
const cairoNow = cairoHourMin(now);
const dayIdx = cairoDayIndex(now);
const key = DAY_ORDER[dayIdx];
const items = WEEK[key] || [];

// Find tasks starting at this minute (including the tag label for the body).
const due = items.filter((it) => it.start === cairoNow);

async function sendPush(title, body) {
  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) { console.log('SKIP: FCM_SERVER_KEY not set'); return; }
  const deviceTokens = (process.env.FCM_DEVICE_TOKEN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!deviceTokens.length) { console.log('SKIP: FCM_DEVICE_TOKEN not set'); return; }

  const url = 'https://fcm.googleapis.com/fcm/send'; // legacy HTTP v1 endpoint
  for (const token of deviceTokens) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'key=' + serverKey,
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, sound: 'default', priority: 'high' },
        data: { click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      }),
    });
    const txt = await res.text();
    console.log(`-> ${res.status} ${token.slice(0, 8)}…: ${txt.slice(0, 120)}`);
  }
}

const dayName = (DAYS.find((d) => d.key === key) || {}).label || key;
if (due.length === 0) {
  console.log(`No task at ${cairoNow} (${dayName}).`);
} else {
  for (const it of due) {
    const t = TAGS?.[it.tag]?.label;
    console.log(`DUE ${cairoNow}: ${it.title}`);
    await sendPush('⏰ حان وقت: ' + it.title, `${dayName} · ${it.start} · ${t || ''}`);
  }
}
process.exit(0);