// Firestore sync so the Telegram bot sees YOUR custom task times even though
// it runs on GitHub's servers (not in your browser). Edits made here are pushed
// to a shared Firestore collection; the bot reads the same collection.
//
// Requirements (one-time, Firebase console):
//   - Cloud Firestore created (Test mode is fine) on the same project.
//   - A GitHub Action secret GOOGLE_SERVICE_ACCOUNT (the project's service
//     account) so the bot can read the collection server-side.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { FIREBASE_CONFIG } from './config';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const EDITS_COL = 'planner-edits';

function taskDoc(id) {
  return doc(db, EDITS_COL, String(id));
}

// Load all stored edits: { id -> { title?, start?, end? } }.
export async function loadEdits() {
  try {
    const snap = await getDoc(doc(db, EDITS_COL, 'index'));
    // index isn't required; we instead list is not supported by getDoc.
    // We store edits under individual doc ids, so fetch them by iterating a
    // known set is impractical. So we ALSO keep a compact index doc.
    const raw = snap.exists() ? (snap.data().all || {}) : {};
    return raw;
  } catch (err) {
    return {};
  }
}

// Save one task edit. Also keeps a compact index {@id:edit} so the bot can
// read everything with ONE getDoc call (simple + cheap).
export async function saveEdit(id, edit) {
  try {
    const ref = doc(db, EDITS_COL, 'index');
    const snap = await getDoc(ref);
    const all = snap.exists() ? (snap.data().all || {}) : {};
    const next = { ...all, [id]: edit };
    await setDoc(ref, { all: next });
    return true;
  } catch (err) {
    return false;
  }
}

// Remove one task edit (cleared) and rebuild index.
export async function removeEdit(id) {
  try {
    const ref = doc(db, EDITS_COL, 'index');
    const snap = await getDoc(ref);
    const all = snap.exists() ? (snap.data().all || {}) : {};
    delete all[id];
    await setDoc(ref, { all });
    await deleteDoc(taskDoc(id)).catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
}

// Replace ALL edits at once (for "reset week").
export async function replaceAllEdits(edits) {
  try {
    const ref = doc(db, EDITS_COL, 'index');
    await setDoc(ref, { all: edits || {} });
    return true;
  } catch (err) {
    return false;
  }
}

// Publish the full merged schedule (schedule.js defaults + your edits + extras) so the
// always-on cloud reminder reads exactly what you see in the app.
// `merged` = { dayKey: [{ id, title, start, end }] }.
export async function publishSchedule(merged) {
  try {
    await setDoc(doc(db, 'planner-schedule', 'index'), { all: merged });
    return true;
  } catch (err) {
    return false;
  }
}

// Publish the done-state (checks) keyed by date so the Telegram bot can know how
// many tasks you finished today and celebrate when you mark one done.
// `checksByDate` = { 'YYYY-MM-DD': { [taskId]: true } }.
export async function publishChecks(checksByDate) {
  try {
    await setDoc(doc(db, 'planner-meta', 'checks'), { byDate: checksByDate || {} });
    return true;
  } catch (err) {
    return false;
  }
}

export { db };
