// Firebase web config (public — safe to commit).
// Instructions: https://console.firebase.google.com -> Project settings -> Your apps -> Web app
//
// Fill these with YOUR project's values. Then also add a VAPID key:
//   Project settings -> Cloud Messaging -> "Web configuration" -> Key pair.
// Paste that key as VAPID_KEY below. The GitHub Actions cron needs FCM_SERVER_KEY too.
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// VAPID key (public, safe to commit) — used on the client to subscribe to push.
export const VAPID_KEY = 'YOUR_VAPID_KEY';