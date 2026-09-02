/* Service Worker: background-capable alarms + offline app shell.
   Network-first for HTML/JS/CSS so first load is always fresh (prevents the
   "blank screen after an interrupted cache" case), cache-fallback for offline.
   Registration happens in main.jsx. */

const CACHE = 'planner-shell-v2';

// Precache entries that must always be available offline.
const PRECACHE = ['./index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache or interfere with the service worker script itself.
  if (url.pathname.endsWith('/sw.js')) return;

  // navigation requests (HTML): network-first, fall back to cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // Everything else (JS/CSS/images): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ---- background notification scheduler ----
let fired = {};
let intervalId = null;
let slots = [];
let slotKey = '';

function pad(n) { return String(n).padStart(2, '0'); }
function nowHHMM() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// The page (App.jsx) arms us each day with that day's slots. We then watch the
// clock and fire a Web Notification when a slot's start-minute arrives, even if
// the tab is running in the background. (Audio alarm is handled in-page.)
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'ARM-SLOTS') return;
  const { slots: newSlots, key } = e.data;
  if (!newSlots || !key) return;
  slots = newSlots;
  slotKey = key;
  if (intervalId) clearInterval(intervalId);
  let lastMinute = '';
  intervalId = setInterval(() => {
    const hmm = nowHHMM();
    if (hmm === lastMinute) return;
    lastMinute = hmm;
    for (const s of slots) {
      const fk = `${slotKey}|${s.id}`;
      if (fired[fk]) continue;
      if (s.start === hmm) {
        fired[fk] = true;
        self.registration.showNotification('⏰ حان وقت: ' + s.title, {
          body: s.body || '',
          tag: fk,
          requireInteraction: true,
        });
      }
    }
    // keep fired map bounded to today
    if (hmm === '00:00') fired = {};
  }, 1000);
});

// ---- Firebase push notifications (delivered even when the site is closed) ----
// The GitHub Actions cron (cloud/send-push.mjs) sends these. Show them as a
// Notification, and when clicked, focus/open the planner.
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = (e.data && e.data.json()) || {};
  } catch (err) {}
  const n = data.notification || data.data || {};
  const title = n.title || 'تذكير المخطط الأسبوعي';
  const body = n.body || '';
  const options = {
    body,
    tag: 'planner-push-' + (n.tag || Date.now()),
    requireInteraction: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Open the planner when the user clicks the notification.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./', self.location.origin).href;
  let focus = () => clients.openWindow(url);
  e.waitUntil(focus());
});