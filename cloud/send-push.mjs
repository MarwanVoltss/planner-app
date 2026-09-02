// GitHub Actions cron: sends an FCM push (v1 API) when a task starts — even if
// the website is closed. Reads the SAME schedule as the app.
//
// Secrets required in the GitHub repo (Settings -> Secrets -> Actions):
//   GOOGLE_SERVICE_ACCOUNT -> the full service-account JSON you download from
//       Firebase Console > Project settings > Service accounts > "Generate new
//       private key". Paste its whole JSON contents as the secret value.
//   FCM_DEVICE_TOKEN -> paste the token shown in the app's "نسخ الرمز" button
//       (separate multiple devices with commas).
//
// The schedule is authored in LOCAL Cairo time (UTC+2 / UTC+3). We convert the
// job's UTC "now" to Cairo and compare against each item.start (24h HH:MM).
import { WEEK, DAYS, DAY_ORDER, TAGS } from '../src/lib/schedule.js';
import { createSign } from 'node:crypto';

// Cairo offset: +2 when no DST (Egypt observed DST occasionally; default +2).
function cairoHourMin(utcNow) {
  const m = utcNow.getUTCMonth(); // 0=Jan
  const winter = m <= 3 || m === 10 || m === 11; // Oct..Mar -> +2, rest -> +3
  const offset = winter ? 2 : 3;
  const d = new Date(utcNow.getTime() + offset * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Map a Cairo day-of-week to our Saturday-first index.
function cairoDayIndex(utcNow) {
  const d = new Date(utcNow.getTime() + 2 * 3600 * 1000);
  const gb = d.getUTCDay();
  return (gb + 1) % 7; // 0=Sat, 1=Sun ... 6=Fri
}

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Mint an OAuth2 access token from the Firebase service account (RS256 JWT).
async function getAccessToken(sa) {
  const { client_email, private_key, token_uri } = sa;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(private_key).toString('base64');
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error('OAuth failed: ' + JSON.stringify(tok).slice(0, 200));
  return tok.access_token;
}

async function sendPush(accessToken, projectId, token, title, body) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + accessToken,
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        webpush: {
          headers: { Urgency: 'high' },
          notification: { requireInteraction: true, body, title },
        },
        data: { click_action: 'PLANNER' },
      },
    }),
  });
  const txt = await res.text();
  console.log(`-> ${res.status} ${token.slice(0, 8)}…: ${txt.slice(0, 140)}`);
}

const now = new Date();
const cairoNow = cairoHourMin(now);
const dayIdx = cairoDayIndex(now);
const key = DAY_ORDER[dayIdx];
const items = WEEK[key] || [];
const due = items.filter((it) => it.start === cairoNow);
const dayName = (DAYS.find((d) => d.key === key) || {}).label || key;

if (due.length === 0) {
  console.log(`No task at ${cairoNow} (${dayName}).`);
  process.exit(0);
}

const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
const deviceTokens = (process.env.FCM_DEVICE_TOKEN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!saJson) { console.error('SKIP: GOOGLE_SERVICE_ACCOUNT secret not set'); process.exit(0); }
if (!deviceTokens.length) { console.error('SKIP: FCM_DEVICE_TOKEN secret not set'); process.exit(0); }

try {
  const sa = JSON.parse(saJson);
  const accessToken = await getAccessToken(sa);
  for (const it of due) {
    const t = TAGS?.[it.tag]?.label;
    console.log(`DUE ${cairoNow}: ${it.title}`);
    for (const tok of deviceTokens) {
      await sendPush(accessToken, sa.project_id, tok, '⏰ حان وقت: ' + it.title, `${dayName} · ${it.start} · ${t || ''}`);
    }
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
process.exit(0);