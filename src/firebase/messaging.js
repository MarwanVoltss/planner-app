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
let lastError = '';
export function getLastPushError() { return lastError; }

export async function subscribeFirebasePush() {
  const ok = ensure();
  if (!ok) { lastError = 'firebase-not-configured'; return null; }
  try {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      lastError = 'browser-unsupported';
      return null;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { lastError = 'permission-denied'; return null; }
    lastError = '';
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });
    if (!token) { lastError = 'no-token'; return null; }
    return token;
  } catch (e) {
    lastError = String((e && e.message) || e);
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