// Firebase web config (public — safe to commit).
// Instructions: https://console.firebase.google.com -> Project settings -> Your apps -> Web app
//
// Fill these with YOUR project's values. Then also add a VAPID key:
//   Project settings -> Cloud Messaging -> "Web configuration" -> Key pair.
// Paste that key as VAPID_KEY below. The GitHub Actions cron needs FCM_SERVER_KEY too.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCxjwOELAwOgdENGOyupcaPg6rNXtBcV2w',
  authDomain: 'gen-lang-client-0675890724.firebaseapp.com',
  projectId: 'gen-lang-client-0675890724',
  storageBucket: 'gen-lang-client-0675890724.firebasestorage.app',
  messagingSenderId: '631673638230',
  appId: '1:631673638230:web:f5d4b1d373021d376e1af7',
};

// VAPID key (public, safe to commit) — used on the client to subscribe to push.
export const VAPID_KEY = 'YOUR_VAPID_KEY';