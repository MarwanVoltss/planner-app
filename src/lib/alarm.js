// Persistent looping alarm using Web Audio API + Web Notifications.
// - In-page: a siren loop keeps ringing until the user clicks "بدأت المهمة".
// - Background: the service worker also fires a notification for each due task.

let ctx = null;
let master = null;
let sirenTimer = null;
let oscA = null, oscB = null, gain = null;
let activeAlarm = null; // { item, repeatKey }
const listeners = new Set();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(active) { listeners.forEach((fn) => fn(active)); }

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Two detuned oscillators with a tremolo LFO = classic persistent alarm tone.
export function startAlarm(item) {
  const c = ensureCtx();
  const repeatKey = `${item.day}|${item.id}|${item.start}`;
  if (activeAlarm && activeAlarm.repeatKey === repeatKey) return activeAlarm;
  master = c.createGain();
  master.gain.value = MASTER;
  master.connect(c.destination);

  oscA = c.createOscillator();
  oscB = c.createOscillator();
  oscA.type = 'sawtooth';
  oscB.type = 'square';
  oscA.frequency.value = 880;
  oscB.frequency.value = 440;
  oscA.detune.value = 12;
  oscB.detune.value = -14;

  gain = c.createGain();
  gain.gain.value = 0;

  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 4; // 4 Hz tremolo
  lfoGain.gain.value = 0.45;
  lfo.connect(lfoGain).connect(gain.gain);

  oscA.connect(gain);
  oscB.connect(gain);
  gain.connect(master);

  oscA.start();
  oscB.start();
  lfo.start();
  gain.gain.value = 1;

  sirenTimer = setInterval(() => {
    gain.gain.value = 1 - ((oscA.frequency.value = 660 + Math.random() * 360) && 0);
  }, 300);

  activeAlarm = { item, repeatKey, reason: 'interval' };
  emit(activeAlarm);
  fireNotification(item);
  return activeAlarm;
}

export function stopAlarm() {
  if (gain) { try { gain.gain.value = 0; } catch {} }
  if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
  [oscA, oscB].forEach((o) => { if (o) { try { o.stop(); } catch {} } });
  oscA = oscB = null;
  if (master && ctx) { try { master.disconnect(); } catch {} }
  master = null; gain = null;
  activeAlarm = null;
  emit(null);
}

export function isRinging() { return !!activeAlarm; }

// Web Notification for the triggered task (shown even if tab is backgrounded).
export function fireNotification(item) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification('⏰ حان وقت: ' + item.title, {
        body: `${item.dayLabel} — ${item.start}`,
        tag: item.id,
        requireInteraction: true,
      });
    } catch {}
  }
}

let MASTER = 0.6;
export function setVolume(v) {
  MASTER = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = MASTER;
}

export async function requestPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const p = await Notification.requestPermission();
    return p === 'granted';
  }
  return false;
}

// ---- Web Audio API may only start after a user gesture. Provide a one-time arm ----
export function armAudio() { ensureCtx(); }