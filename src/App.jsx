import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, BellRing, Check, Clock, Pencil, Volume2, Sun, Flame, BookOpen,
  Dumbbell, Package, Moon, Coffee, Pizza, MapPin, ListChecks, Sparkles,
} from 'lucide-react';
import { WEEK, DAYS, TAGS, DAY_ORDER } from './lib/schedule';
import { subscribe, startAlarm, stopAlarm, isRinging, requestPermission, armAudio, setVolume } from './lib/alarm';
import { subscribeFirebasePush, onFirebaseMessage, getLastPushError } from './firebase/messaging';
import { FIREBASE_CONFIG } from './firebase/config';

const STORE_KEY = 'planner-state-v1';

const TAG_ICON = {
  wake: Sun,
  study: BookOpen,
  rest: Coffee,
  meal: Pizza,
  prayer: MapPin,
  gym: Dumbbell,
  store: Package,
  read: BookOpen,
  sleep: Moon,
};

// localStorage helpers -------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return null;
}

function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Convert "HH:MM" (24h) to a 12-hour display string like "10:30 ص".
function fmt12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'ص' : 'م';
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function nowTime() {
  return toHHMM(new Date());
}

function minutesOf(hhmm) {
  if (!hhmm) return -1;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Work out "today" (Saturday-based week) ------------------------------------
function todayKey() {
  const jd = new Date().getDay(); // 0 Sun, 1 Mon ... 6 Sat
  // Our calendar starts Saturday: jd 6(Sat)->idx 0, 0(Sun)->1, 1->2 ... 5(Fri)->6
  const idx = (jd + 1) % 7;
  return DAY_ORDER[idx];
}

// The alarm scheduler: checks every second while the tab is open. -----------
function useAlarmScheduler({ edits, checks }) {
  const editsRef = useRef(edits);
  const checksRef = useRef(checks);
  const firedRef = useRef({});
  const [active, setActive] = useState(isRinging());

  useEffect(() => { editsRef.current = edits; }, [edits]);
  useEffect(() => { checksRef.current = checks; }, [checks]);

  useEffect(() => {
    const unsub = subscribe((a) => setActive(a));
    const tick = () => {
      if (isRinging()) return; // don't stack while one is ringing
      const t = nowTime();
      const day = todayKey();
      const items = WEEK[day] || [];
      for (const base of items) {
        const key = `${day}|${base.id}`;
        if (firedRef.current[key]) continue;
        const item = {
          ...base,
          day,
          dayLabel: (DAYS.find((d) => d.key === day) || {}).label,
          title: (editsRef.current[base.id]?.title) || base.title,
          start: (editsRef.current[base.id]?.start) || base.start,
          end: (editsRef.current[base.id]?.end) || base.end,
          done: checksRef.current[base.id],
        };
        if (item.done) continue; // already completed
        if (minutesOf(t) === minutesOf(item.start)) {
          firedRef.current[key] = true;
          startAlarm(item);
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    // clear fired flags each new day
    const dayReset = setInterval(() => {
      const today = todayKey();
      firedRef.current = Object.fromEntries(
        Object.entries(firedRef.current).filter(([k]) => k.startsWith(today))
      );
    }, 60000);
    return () => { clearInterval(id); clearInterval(dayReset); unsub(); };
  }, []);
  return active;
}

export default function App() {
  const [day, setDay] = useState(todayKey());
  const [checks, setChecks] = useState(() => loadState()?.checks || {});
  const [edits, setEdits] = useState(() => loadState()?.edits || {});
  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [pushToken, setPushToken] = useState(() => localStorage.getItem('fcm-token') || '');
  const [pushError, setPushError] = useState('');
  const [now, setNow] = useState(nowTime());
  const [previewTime, setPreviewTime] = useState('07:30'); // for demo/test alarm
  const [greeting, setGreeting] = useState(greet());

  const persist = useCallback(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ checks, edits }));
  }, [checks, edits]);

  useEffect(() => { persist(); }, [persist]);
  useEffect(() => { const id = setInterval(() => setNow(nowTime()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { const id = setInterval(() => setGreeting(greet()), 30000); return () => clearInterval(id); }, []);

  // Arm the service worker with today's slots so background notifications fire.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      const day = todayKey();
      const slots = (WEEK[day] || []).map((base) => {
        const e = edits[base.id] || {};
        return {
          id: base.id,
          start: e.start || base.start,
          title: e.title || base.title,
          body: `${(DAYS.find((d) => d.key === day) || {}).label} — ${e.start || base.start}`,
        };
      });
      if (reg.active) reg.active.postMessage({ type: 'ARM-SLOTS', slots, key: day });
    });
  }, [edits, day, checks]);

  const active = useAlarmScheduler({ checks, edits });
  const showAlarm = !!active;
  const activeItem = active ? active.item : null;
  const unconfigured =
    FIREBASE_CONFIG.apiKey.indexOf('YOUR_') === 0 ||
    !FIREBASE_CONFIG.apiKey;

  // Foreground push: when a task-start push arrives while the app is open,
  // surface a notification too (the cron also fires an alert when closed).
  useEffect(() => {
    if (!pushToken) return;
    const unsub = onFirebaseMessage((payload) => {
      const { title, body } = payload.notification || {};
      if (title && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch (e) {}
      }
    });
    return () => { unsub.then((fn) => fn && fn()); };
  }, [pushToken]);

  const perItem = useMemo(() => {
    const source = WEEK[day] || [];
    return source.map((it) => {
      const e = edits[it.id] || {};
      return { ...it, title: e.title || it.title, start: e.start || it.start, end: e.end ?? it.end };
    });
  }, [day, edits]);

  const doneCount = perItem.filter((it) => checks[it.id]).length;
  const total = perItem.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  function toggleCheck(id) {
    setChecks((c) => ({ ...c, [id]: !c[id] }));
  }

  function updateItem(id, patch) {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));
  }

  function resetDay() {
    const d = {};
    perItem.forEach((it) => { d[it.id] = false; });
    setChecks((c) => ({ ...c, ...d }));
    setEdits({});
  }

  function resetAll() {
    setChecks({});
    setEdits({});
  }

  return (
    <div className="min-h-full mx-auto max-w-xl px-3 sm:px-5 pb-28 pt-4">
      {/* Header + clock + greeting */}
      <header className="glass rounded-3xl p-5 mb-5 neon-ring relative overflow-hidden">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/60 to-transparent" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/40 to-cyan-500/30 border border-violet-300/40 shadow-[0_0_18px_-4px_rgba(167,139,250,0.7)]">
              <Sparkles className="text-violet-200" size={20} />
            </span>
            <div>
              <h1 className="text-lg font-black text-white leading-none bg-gradient-to-r from-violet-200 to-cyan-200 bg-clip-text text-transparent">المخطط الأسبوعي</h1>
              <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" />{greeting}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-black tabular-nums text-white tracking-tight" dir="ltr">{fmt12(now)}</div>
            <div className="text-[11px] mt-0.5 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/30 text-violet-200">
              {(DAYS.find((d) => d.key === day) || {}).label}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-gray-300 flex items-center gap-1.5 font-medium">
              <ListChecks size={14} className="text-violet-300" />
              تقدم اليوم
            </span>
            <span className="tabular-nums text-violet-300 font-bold bg-violet-500/10 border border-violet-400/30 px-2 py-0.5 rounded-full">{doneCount}/{total} · {pct}%</span>
          </div>
          <div className="progress-track h-3.5 rounded-full">
            <div className="progress-fill rounded-full" style={{ width: `${pct}%` }} />
          </div>
          {total > 0 && pct === 100 && (
            <p className="mt-2 text-center text-[12px] text-emerald-300 font-semibold">أنجزت كل مهام اليوم 🏆</p>
          )}
        </div>
      </header>

      {/* Push notifications banner */}
      {!pushToken && notifPerm !== 'unsupported' && (
        <div className="glass rounded-2xl p-3 mb-4 flex items-center gap-3 border-amber-400/30">
          <Bell size={16} className="text-amber-300" />
          {unconfigured ? (
            <p className="text-[12px] text-gray-300 flex-1">إشعارات المنبه جاهزة في الكود، بس محتاجة نضبط حساب Firebase. كلم Marwan يعمل الخطوات في README.</p>
          ) : (
            <p className="text-[12px] text-gray-300 flex-1">فعّل إشعارات المنبه — بالـ push هيوصلك حتى لو الموقع مقفول.</p>
          )}
          {!unconfigured && (
            <button
              onClick={async () => {
                setPushError('');
                const ok = await requestPermission();
                if (ok) setNotifPerm('granted');
                armAudio();
                const tok = await subscribeFirebasePush();
                if (tok) {
                  localStorage.setItem('fcm-token', tok);
                  setPushToken(tok);
                } else {
                  setPushError(getLastPushError() || 'تعذر الحصول على رمز الإشعار');
                }
              }}
              className="shrink-0 text-[12px] px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30 cursor-pointer transition-colors"
            >
              تفعيل
            </button>
          )}
          {pushError && (
            <p className="text-[11px] text-rose-400 mt-2 w-full" dir="ltr">push-err: {pushError}</p>
          )}
        </div>
      )}
      {pushToken && notifPerm === 'granted' && (
        <div className="glass rounded-2xl px-3 py-2 mb-4 flex items-center gap-2 border-emerald-400/30">
          <BellRing size={14} className="text-emerald-300" />
          <span className="text-[12px] text-emerald-200 flex-1">إشعارات المنبه مفعّلة — هيوصلك حتى لو الموقع مقفول.</span>
          <button
            onClick={async (e) => {
              try { await navigator.clipboard.writeText(pushToken); } catch (err) {}
              document.getElementById('copy-tok-msg')?.remove();
              const m = document.createElement('span');
              m.id = 'copy-tok-msg';
              m.textContent = 'تم النسخ ✓';
              m.className = 'text-[10px] text-emerald-400';
              e.currentTarget.parentElement.appendChild(m);
              setTimeout(() => m.remove(), 1500);
            }}
            title="انسخ رمز الجهاز لتفعيل push من الخادم"
            className="shrink-0 text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/20 cursor-pointer transition-colors"
          >
            نسخ الرمز
          </button>
        </div>
      )}

      {/* Day tabs */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
        {DAYS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDay(d.key)}
            className={`shrink-0 w-[76px] rounded-2xl border px-2 py-2.5 text-center transition-all cursor-pointer ${
              day === d.key
                ? 'tab-active scale-[1.03]'
                : 'border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/25 active:scale-95'
            }`}
          >
            <div className="text-[13px] font-bold">{d.label}</div>
            <div className={`text-[10px] truncate ${day === d.key ? 'text-violet-200/70' : 'text-gray-500'}`}>{d.sub}</div>
          </button>
        ))}
      </div>

      {/* Reset controls */}
      <div className="flex items-center justify-between mb-2 text-[12px]">
        <span className="text-gray-500">يوم {DAYS.find((x) => x.key === day)?.label}</span>
        <div className="flex gap-2">
          <button onClick={resetDay} className="px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/25 transition-colors cursor-pointer">تصفير اليوم</button>
          <button onClick={resetAll} className="px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-red-300 hover:border-red-400/40 transition-colors cursor-pointer">تصفير الأسبوع</button>
        </div>
      </div>

      {/* Schedule list */}
      <div className="space-y-2">
        {perItem.map((it) => {
          const Icon = TAG_ICON[it.tag] || Clock;
          const color = TAGS[it.tag]?.c || '#a78bfa';
          const done = !!checks[it.id];
          const isNow = it.start === now;
          return (
            <TaskRow
              key={it.id}
              it={it}
              color={color}
              Icon={Icon}
              done={done}
              isNow={isNow}
              onChangeTitle={(v) => updateItem(it.id, { title: v })}
              onChangeStart={(v) => updateItem(it.id, { start: v })}
              onChangeEnd={(v) => updateItem(it.id, { end: v })}
              onToggle={() => toggleCheck(it.id)}
              showEdit={!done}
            />
          );
        })}
      </div>

      {/* Alarm modal */}
      {showAlarm && activeItem && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => {}} />
          <div className="alarm-modal relative glass rounded-3xl p-6 w-full max-w-sm text-center border border-rose-400/50" style={{ background: 'rgba(20,10,24,0.92)' }}>
            <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/50 grid place-items-center alarm-pulse mb-4">
              <BellRing className="text-rose-400" size={30} />
            </div>
            <h2 className="text-xl font-black text-white mb-1">⏰ حان وقت المهمة</h2>
            <div className="text-gray-400 text-sm mb-1">{activeItem.dayLabel} — {fmt12(activeItem.start)}</div>
            <p className="text-lg font-bold text-rose-300 mb-5">{activeItem.title}</p>
            <div className="flex items-center gap-2 mb-6 justify-center">
              <Volume2 size={14} className="text-rose-400" />
              <input
                type="range"
                className="neon w-40"
                min="0"
                max="100"
                defaultValue="60"
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
              />
            </div>
            <button
              onClick={() => {
                stopAlarm();
                if (activeItem) toggleCheck(activeItem.id);
              }}
              className="w-full py-3 rounded-2xl text-white font-black text-lg bg-gradient-to-r from-rose-500 to-fuchsia-500 hover:from-rose-400 hover:to-fuchsia-400 cursor-pointer transition-all shadow-[0_0_30px_-6px_rgba(244,63,94,0.8)]"
            >
              بدأت المهمة (إيقاف المنبه)
            </button>
          </div>
        </div>
      )}

      {/* Bottom utility bar */}
      <AlarmDemo previewTime={previewTime} setPreviewTime={setPreviewTime} day={day} edits={edits} checks={checks} />
    </div>
  );
}

function TaskRow({ it, color, Icon, done, isNow, onChangeTitle, onChangeStart, onChangeEnd, onToggle, showEdit }) {
  const [open, setOpen] = useState(false);
  const tagLabel = TAGS[it.tag]?.label || '';
  return (
    <div
      className={`glass rounded-2xl px-3.5 py-3 transition-all group ${
        done ? 'opacity-50' : 'hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-12px_rgba(167,139,250,0.4)]'
      } ${isNow ? 'neon-ring' : ''}`}
      style={isNow ? { borderColor: 'rgba(167,139,250,0.75)' } : {}}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          aria-label={done ? 'إلغاء إتمام' : 'إتمام'}
          className={`shrink-0 grid place-items-center w-6 h-6 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
            done
              ? 'bg-emerald-500 border-emerald-400 text-white shadow-[0_0_12px_-2px_rgba(52,211,153,0.8)]'
              : 'border-white/20 text-transparent hover:border-violet-400 hover:scale-110'
          }`}
        >
          <Check size={14} strokeWidth={3.5} />
        </button>

        <div
          className="w-10 h-10 shrink-0 rounded-xl grid place-items-center transition-transform group-hover:scale-105"
          style={{ background: `${color}1f`, border: `1px solid ${color}55` }}
        >
          <Icon size={18} style={{ color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className={`text-[14px] leading-snug ${done ? 'text-gray-400 line-through' : 'text-gray-100 font-semibold'}`}>{it.title}</div>
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
            {tagLabel && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: `${color}22`, color }}>
                {tagLabel}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] tabular-nums px-1.5 py-0.5 rounded-md bg-black/30 border border-white/10 text-gray-300">
              <Clock size={11} className="text-white/40" />
              <span dir="ltr">{fmt12(it.start)}</span>
              {it.end && <span dir="ltr" className="text-gray-500">← {fmt12(it.end)}</span>}
            </span>
          </div>
        </div>

        {showEdit && (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="تعديل"
            title="تعديل المهمة"
            className={`shrink-0 p-2 rounded-xl transition-colors cursor-pointer ${
              open ? 'bg-violet-500/20 text-violet-300' : 'text-gray-400 hover:text-violet-300 hover:bg-violet-500/10'
            }`}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5 text-[13px]">
          <div className="col-span-2 flex items-center gap-2 text-violet-300 font-semibold">
            <Pencil size={13} /> تعديل المهمة
          </div>
          <input
            className="col-span-2 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-shadow"
            defaultValue={it.title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="عنوان المهمة"
          />
          <label className="text-[11px] text-gray-400 col-span-2 -mb-1">الأوقات</label>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={13} /> البداية
            <input
              type="time"
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white tabular-nums focus:border-violet-400 focus:outline-none"
              value={it.start}
              onChange={(e) => onChangeStart(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={13} /> النهاية
            <input
              type="time"
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white tabular-nums focus:border-violet-400 focus:outline-none"
              value={it.end || ''}
              onChange={(e) => onChangeEnd(e.target.value || null)}
            />
          </div>
          <button onClick={() => setOpen(false)} className="col-span-2 mt-1.5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/40 to-cyan-500/30 hover:from-violet-500/50 hover:to-cyan-500/40 border border-violet-400/30 text-white font-semibold cursor-pointer transition-all">حفظ التعديل</button>
        </div>
      )}
    </div>
  );
}

function AlarmDemo({ previewTime, setPreviewTime, day, edits, checks }) {
  return (
    <div className="glass rounded-2xl p-4 mt-6 text-[12px]">
      <div className="flex items-center gap-2 mb-3 text-gray-400">
        <Flame size={15} className="text-fuchsia-400" />
        <span className="font-bold text-gray-200">تجربة المنبه (Test)</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="time"
          className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white tabular-nums flex-1 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 transition-shadow"
          value={previewTime}
          onChange={(e) => setPreviewTime(e.target.value)}
        />
        <button
          onClick={() => {
            armAudio();
            const items = WEEK[day] || [];
            const target = items.find((b) => !checks[b.id]) || items[0];
            if (!target) return;
            const item = {
              ...target,
              day,
              dayLabel: (DAYS.find((x) => x.key === day) || {}).label,
              title: edits[target.id]?.title || target.title,
              start: edits[target.id]?.start || target.start,
              end: edits[target.id]?.end || target.end,
            };
            startAlarm(item);
          }}
          className="shrink-0 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-500/40 to-rose-500/30 border border-fuchsia-400/40 text-fuchsia-100 hover:from-fuchsia-500/50 hover:to-rose-500/40 cursor-pointer transition-all active:scale-95 font-semibold"
        >
          <BellRing size={15} className="inline mr-1" /> جرّب المنبه
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mt-2.5 leading-relaxed">المنبه الفعلي يشتغل تلقائيًا لوحده وقت بداية كل مهمة. جرّبه بيشغّل المنبه النهارده مكان المهمة الأولانية اللي لسه ما خلصتش.</p>
    </div>
  );
}

function greet() {
  const h = new Date().getHours();
  if (h < 5) return 'سحور وتفوق 🌙';
  if (h < 12) return 'صباح النور والتركيز ☀️';
  if (h < 17) return 'نهارك مليان إنتاجية ⚡';
  if (h < 21) return 'كمّل لبعد، لسه مفيش مستحيل 🔥';
  return 'صباح النور... لأ، مساء الخير 🌙';
}