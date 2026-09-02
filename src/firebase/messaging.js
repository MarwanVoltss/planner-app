import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { FIREBASE_CONFIG, VAPID_KEY } from './config.js';

let app = null;
let messaging = null;

function ensure() {
  if (FIREBASE_CONFIG.apiKey.indexOf('YOUR_') === 0) {
    console.warn('Firebase: config placeholders not replaced yet.');
    return null;
  }
  if (!app) app = initializeApp(FIREBASE_CONFIG);
  if ('serviceWorker' in navigator) {
    app && (messaging = getMessaging(app));
  }
  return app;
}

// Ask the browser for notification permission and a push token.
// Returns the device token, or null if not available.
export async function subscribeFirebasePush() {
  const ok = ensure();
  if (!ok) return null;
  try {
    const perm = Notification && Notification.requestPermission();
    if ((await perm) !== 'granted') return null;
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });
    return token || null;
  } catch (e) {
    console.error('Firebase token error', e);
    return null;
  }
}

// Foreground push handler: show a nicer in-app notification.
export async function onFirebaseMessage(cb) {
  const ok = ensure();
  if (!ok) return () => {};
  return onMessage(messaging, (payload) => cb(payload));
}

// True once a token exists on this device (persisted by FCM SDK).
export function isSubscribed() {
  return ensure() && 'serviceWorker' in navigator;
}