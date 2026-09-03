import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, Clock, Pencil, Sun, BookOpen,
  Dumbbell, Package, Moon, Coffee, Pizza, MapPin, ListChecks, Sparkles, Languages, Palette, X, Briefcase, Code2, ChevronDown,
} from 'lucide-react';
import { WEEK, DAYS, TAGS, DAY_ORDER } from './lib/schedule';
import { loadEdits, saveEdit, removeEdit, replaceAllEdits, publishSchedule, publishChecks } from './firebase/firestore';

const STORE_KEY = 'planner-state-v1';
const SETTINGS_KEY = 'planner-settings-v1';

// i18n ----------------------------------------------------------------
const STR = {
  en: {
    title: 'Weekly Planner',
    clear: 'Reset Week',
    clearDay: 'Reset Day',
    dayLabel: 'Day',
    progress: 'Progress',
    doneAll: 'You finished every task today 🏆',
    toggleDone: 'Mark done',
    toggleUndone: 'Mark not done',
    edit: 'Edit task',
    editTitle: 'Edit task',
    titlePlaceholder: 'Task title',
    timeLabel: 'Times',
    start: 'Start',
    end: 'End',
    saveEdit: 'Save edit',
    addTitle: 'Title',
    addType: 'Type',
    addBtn: 'Add task',
    cancel: 'Cancel',
    theme: 'Theme',
    language: 'Language',
    settings: 'Settings',
    close: 'Close',
    of: 'of',
  },
  ar: {
    title: 'المخطط الأسبوعي',
    clear: 'تصفير الأسبوع',
    clearDay: 'تصفير اليوم',
    dayLabel: 'يوم',
    progress: 'تقدم اليوم',
    doneAll: 'أنجزت كل مهام اليوم 🏆',
    toggleDone: 'إتمام',
    toggleUndone: 'إلغاء إتمام',
    edit: 'تعديل المهمة',
    editTitle: 'تعديل المهمة',
    titlePlaceholder: 'عنوان المهمة',
    timeLabel: 'الأوقات',
    start: 'البداية',
    end: 'النهاية',
    saveEdit: 'حفظ التعديل',
    addTitle: 'عنوان المهمة',
    addType: 'نوع المهمة',
    addBtn: 'إضافة',
    cancel: 'إلغاء',
    theme: 'الوجه',
    language: 'اللغة',
    settings: 'الإعدادات',
    close: 'إغلاق',
    of: 'من',
  },
};

// Greeting keyed by hour, language-agnostic (emoji carries mood).
const GREET_AR = [
  ['سحور وتفوق 🌙', 'صباح النور والتركيز ☀️', 'نهارك مليان إنتاجية ⚡', 'كمّل لبعد، لسه مفيش مستحيل 🔥', 'مساء الخير 🌙'],
  ['Suhoor power 🌙', 'Good morning, focus up ☀️', 'Productive noon ⚡', 'Keep going, nothing impossible 🔥', 'Good evening 🌙'],
];

const THEMES = {
  violet: { name: 'بنفسجي', nameEn: 'Violet', vars: { '--neon': '#a78bfa', '--neon2': '#22d3ee', '--line': 'rgba(139,92,246,0.18)' } },
  cyan: { name: 'سماوي', nameEn: 'Cyan', vars: { '--neon': '#22d3ee', '--neon2': '#a78bfa', '--line': 'rgba(34,211,238,0.20)' } },
  rose: { name: 'وردي', nameEn: 'Rose', vars: { '--neon': '#fb7185', '--neon2': '#f472b6', '--line': 'rgba(244,63,94,0.20)' } },
  emerald: { name: 'زمردي', nameEn: 'Emerald', vars: { '--neon': '#34d399', '--neon2': '#38bdf8', '--line': 'rgba(52,211,153,0.20)' } },
  amber: { name: 'كهرماني', nameEn: 'Amber', vars: { '--neon': '#fbbf24', '--neon2': '#fb7185', '--line': 'rgba(251,191,36,0.22)' } },
};

// localStorage helpers -------------------------------------------------
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function loadState() {
  const s = loadJSON(STORE_KEY);
  return s && typeof s === 'object' ? s : null;
}

function loadSettings() {
  const s = loadJSON(SETTINGS_KEY);
  return (s && typeof s === 'object') ? s : {};
}

function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Convert "HH:MM" to a 12-hour display string like "10:30 ص".
function fmt12(hhmm, lang) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suf = lang === 'en' ? (h < 12 ? 'AM' : 'PM') : (h < 12 ? 'ص' : 'م');
  return `${h12}:${String(m).padStart(2, '0')} ${suf}`;
}

function nowTime() { return toHHMM(new Date()); }

function todayKey() {
  const jd = new Date().getDay();
  return DAY_ORDER[(jd + 1) % 7];
}

export default function App() {
  const [day, setDay] = useState(todayKey());
  const [checks, setChecks] = useState(() => loadState()?.checks || {});
  const [edits, setEdits] = useState(() => loadState()?.edits || {});
  const [extras, setExtras] = useState(() => loadState()?.extras || {});
  const [deletes, setDeletes] = useState(() => loadState()?.deletes || {});
  const [now, setNow] = useState(nowTime());
  const settings = loadSettings();
  const [lang, setLang] = useState(settings.lang || 'ar');
  const [theme, setTheme] = useState(settings.theme || 'violet');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formTag, setFormTag] = useState('rest');
  const [formStart, setFormStart] = useState(() => nowTime().slice(0, 5));

  const t = STR[lang];

  // Apply theme accent vars to <html>.
  useEffect(() => {
    const vars = THEMES[theme]?.vars || THEMES.violet.vars;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.setAttribute('lang', lang === 'en' ? 'en' : 'ar');
    root.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
  }, [theme, lang]);

  const persist = useCallback(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ checks, edits, extras, deletes }));
  }, [checks, edits, extras, deletes]);
  useEffect(() => { persist(); }, [persist]);

  // Load any server-side edits (shared with the Telegram bot) once.
  useEffect(() => {
    let alive = true;
    loadEdits().then((remote) => {
      if (!alive) return;
      const merged = { ...(loadState()?.edits || {}), ...remote };
      setEdits(merged);
      localStorage.setItem(STORE_KEY, JSON.stringify({ checks: loadState()?.checks || {}, edits: merged, extras: loadState()?.extras || {}, deletes: loadState()?.deletes || {} }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Push edits to Firestore so the bot sends at your customized times.
  const editedEntries = Object.keys(edits);
  const editedJson = JSON.stringify(edits);
  useEffect(() => {
    const payload = JSON.parse(editedJson);
const jobs = Object.entries(payload).map(([id, e]) =>
  e && (e.title || e.start || e.end || e.tag) ? saveEdit(id, e) : removeEdit(id)
);
    Promise.all(jobs).catch(() => {});
  }, [editedJson, editedEntries.length]);

  // Publish the full merged week schedule (defaults + edits + extras) to Firestore
  // so the always-on cloud reminder runs on exactly what you see in the app.
  const extrasJson = JSON.stringify(extras);
  const deletesJson = JSON.stringify(deletes);
  useEffect(() => {
    const merged = {};
    for (const dk of Object.keys(WEEK)) {
      merged[dk] = (WEEK[dk] || [])
        .filter((it) => !deletes[it.id])
        .map((it) => {
          const e = edits[it.id] || {};
          return { id: it.id, title: e.title || it.title, start: e.start || it.start, end: e.end ?? it.end, tag: e.tag || it.tag };
        });
    }
    // Append any user-added tasks for each day.
    for (const dk of Object.keys(extras || {})) {
      const list = merged[dk] || (merged[dk] = []);
      for (const x of extras[dk] || []) {
        const e = edits[x.id] || {};
        list.push({ id: x.id, title: e.title || x.title, start: e.start || x.start, end: e.end ?? x.end, tag: e.tag || x.tag });
      }
    }
    publishSchedule(merged).catch(() => {});
  }, [editedJson, extrasJson, deletesJson]);

  // Publish the done-state (checks) to Firestore keyed by today's date so the
  // bot can see how many tasks remain today and celebrate when you finish one.
  const checksJson = JSON.stringify(checks);
  useEffect(() => {
    const d = new Date();
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    publishChecks({ [key]: checks }).catch(() => {});
  }, [checksJson]);

  useEffect(() => { const id = setInterval(() => setNow(nowTime()), 1000); return () => clearInterval(id); }, []);

  const saveSettings = useCallback((patch) => {
    const next = { ...loadSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  function setLangAnd(l) { setLang(l); saveSettings({ lang: l }); }
  function setThemeAnd(thm) { setTheme(thm); saveSettings({ theme: thm }); }

  const perItem = useMemo(() => {
    const source = WEEK[day] || [];
    const base = source
      .filter((it) => !deletes[it.id])
      .map((it) => {
        const e = edits[it.id] || {};
        return { ...it, title: e.title || it.title, start: e.start || it.start, end: e.end ?? it.end, tag: e.tag || it.tag };
      });
    const extra = (extras[day] || []).map((x) => {
      const e = edits[x.id] || {};
      return { ...x, title: e.title || x.title, start: e.start || x.start, end: e.end ?? x.end, tag: e.tag || x.tag };
    });
    const byTime = (a, b) => {
      const toMin = (s) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
        if (!m) return Number.MAX_SAFE_INTEGER; // بلا وقت → آخر القائمة
        return Number(m[1]) * 60 + Number(m[2]);
      };
      return toMin(a.start) - toMin(b.start);
    };
    return [...base, ...extra].sort(byTime);
  }, [day, edits, extras, deletes]);

  const doneCount = perItem.filter((it) => checks[it.id]).length;
  const total = perItem.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  function toggleCheck(id) { setChecks((c) => ({ ...c, [id]: !c[id] })); }
  function updateItem(id, patch) { setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } })); }

  // Add a brand-new custom task (from the inline form) to the currently selected day.
  function addTask() {
    const id = `extra-${Date.now()}`;
    setExtras((ex) => {
      const list = ex[day] || [];
      return { ...ex, [day]: [...list, { id, title: formTitle, start: formStart || now, end: null, tag: formTag }] };
    });
    setFormTitle('');
    setFormStart(nowTime().slice(0, 5));
    setShowAddForm(false);
  }
  // Remove a task (custom extras or a base default task, either way it's hidden + unpublished).
  function removeTask(id) {
    const isExtra = (extras[day] || []).some((x) => x.id === id);
    if (isExtra) {
      setExtras((ex) => {
        const next = { ...ex };
        Object.keys(next).forEach((dk) => { next[dk] = next[dk].filter((x) => x.id !== id); });
        return next;
      });
    } else {
      setDeletes((d) => ({ ...d, [id]: true }));
    }
    setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
    setChecks((c) => { const n = { ...c }; delete n[id]; return n; });
  }

  function resetDay() {
    const d = {};
    perItem.forEach((it) => { d[it.id] = false; });
    setChecks((c) => ({ ...c, ...d }));
    setEdits({});
  }
  function resetAll() { setChecks({}); setEdits({}); setDeletes({}); replaceAllEdits({}).catch(() => {}); }

  const helloIdx = () => {
    const h = new Date().getHours();
    if (h < 5) return 0;
    if (h < 12) return 1;
    if (h < 17) return 2;
    if (h < 21) return 3;
    return 4;
  };
  const greeting = GREET_AR[lang === 'en' ? 1 : 0][helloIdx()];

  return (
    <div className="min-h-full mx-auto max-w-xl px-3 sm:px-5 pb-28 pt-4">
      {/* Header */}
      <header className="glass rounded-3xl p-5 mb-5 relative overflow-hidden" style={{ boxShadow: '0 0 0 1px var(--line), 0 0 26px -8px var(--neon)' }}>
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-10 h-10 rounded-2xl bg-white/5 border border-white/15" style={{ boxShadow: '0 0 18px -4px var(--neon)' }}>
              <Sparkles className="text-white/80" size={20} />
            </span>
            <div>
              <h1 className="text-lg font-black leading-none text-white bg-gradient-to-r from-white/90 to-white/50 bg-clip-text text-transparent">{t.title}</h1>
              <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />{greeting}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-2xl font-black tabular-nums text-white tracking-tight" dir="ltr">{fmt12(now, lang)}</div>
              <div className="text-[11px] mt-0.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/15 text-gray-200">
                {(DAYS.find((d) => d.key === day) || {}).label}
              </div>
            </div>
            <button
              onClick={() => setShowSettings((s) => !s)}
              title={t.settings}
              aria-label={t.settings}
              className="grid place-items-center w-9 h-9 rounded-xl bg-white/5 border border-white/15 text-gray-300 hover:text-white hover:border-white/30 cursor-pointer transition-colors"
            >
              {showSettings ? <X size={16} /> : <Palette size={16} />}
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-gray-300 flex items-center gap-1.5 font-medium">
              <ListChecks size={14} className="text-white/70" />
              {t.progress}
            </span>
            <span className="tabular-nums text-white font-bold bg-white/10 border border-white/15 px-2 py-0.5 rounded-full">{doneCount}/{total} · {pct}%</span>
          </div>
          <div className="progress-track h-3.5 rounded-full">
            <div className="progress-fill rounded-full" style={{ width: `${pct}%` }} />
          </div>
          {total > 0 && pct === 100 && (
            <p className="mt-2 text-center text-[12px] text-emerald-300 font-semibold">{t.doneAll}</p>
          )}
        </div>
      </header>

      {/* Settings panel (language + theme) */}
      {showSettings && (
        <div className="glass rounded-2xl p-4 mb-4 text-[13px]" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-3 text-gray-200 font-bold">
            <Palette size={15} className="text-white/70" /> {t.settings}
          </div>

          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2 text-gray-400 font-medium">
              <Languages size={14} /> {t.language}
            </div>
            <div className="flex gap-2">
              {(['ar', 'en']).map((l) => (
                <button
                  key={l}
                  onClick={() => setLangAnd(l)}
                  className={`px-4 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                    lang === l
                      ? 'text-white border-white/40 bg-white/10'
                      : 'text-gray-400 border-white/10 hover:text-white'
                  }`}
                >
                  {l === 'ar' ? 'العربية' : 'English'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2 text-gray-400 font-medium">
              <Palette size={14} /> {t.theme}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(THEMES).map(([key, th]) => {
                const c = th.vars['--neon'];
                return (
                  <button
                    key={key}
                    onClick={() => setThemeAnd(key)}
                    title={lang === 'en' ? th.nameEn : th.name}
                    className={`w-9 h-9 rounded-xl border cursor-pointer transition-transform ${
                      theme === key ? 'scale-110' : 'hover:scale-105'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${c}, ${c}66)`,
                      borderColor: theme === key ? '#fff' : 'rgba(255,255,255,0.15)',
                      boxShadow: theme === key ? `0 0 14px -2px ${c}` : 'none',
                    }}
                    aria-label={lang === 'en' ? th.nameEn : th.name}
                  />
                );
              })}
            </div>
          </div>
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
            <div className={`text-[10px] truncate ${day === d.key ? 'text-white/60' : 'text-gray-500'}`}>{d.sub}</div>
          </button>
        ))}
      </div>

      {/* Reset controls */}
      <div className="flex items-center justify-between mb-2 text-[12px]">
        <span className="text-gray-500">{lang === 'en' ? DAYS.find((x) => x.key === day)?.sub : `يوم ${DAYS.find((x) => x.key === day)?.label}`}</span>
        <div className="flex gap-2">
          <button onClick={resetDay} className="px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/25 transition-colors cursor-pointer">{t.clearDay}</button>
          <button onClick={resetAll} className="px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-red-300 hover:border-red-400/40 transition-colors cursor-pointer">{t.clear}</button>
        </div>
      </div>

      {/* Schedule list */}
      <div className="space-y-2">
        {perItem.map((it, idx) => {
          const Icon = TAG_ICON[it.tag] || Clock;
          const color = TAGS[it.tag]?.c || '#a78bfa';
          const done = !!checks[it.id];
          const isNow = it.start === now;
          return (
            <TaskRow
              key={it.id}
              num={idx + 1}
              it={it}
              color={color}
              Icon={Icon}
              done={done}
              isNow={isNow}
              lang={lang}
              t={t}
              onChangeTitle={(v) => updateItem(it.id, { title: v })}
              onChangeStart={(v) => updateItem(it.id, { start: v })}
              onChangeEnd={(v) => updateItem(it.id, { end: v })}
              onChangeTag={(v) => updateItem(it.id, { tag: v })}
              onToggle={() => toggleCheck(it.id)}
              showEdit={!done}
              onRemove={() => removeTask(it.id)}
            />
          );
        })}
      </div>

      {/* Add task button + inline form */}
      {showAddForm ? (
        <div className="glass rounded-2xl mt-3 p-4 border border-white/15" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[13px] font-bold text-gray-200 mb-2">{lang === 'en' ? 'New task' : 'مهمة جديدة'}</p>
          <input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder={t.addTitle}
            className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white focus:border-white/40 focus:outline-none mb-2"
          />
          <label className="text-[11px] text-gray-400 mb-1 block">{t.addType}</label>
          <TagPicker value={formTag} onSelect={setFormTag} />
          <label className="text-[11px] text-gray-400 mt-2">{t.start}</label>
          <input
            type="time"
            value={formStart}
            onChange={(e) => setFormStart(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white focus:border-white/40 focus:outline-none mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={addTask}
              disabled={!formTitle.trim() || !/^\d{1,2}:\d{2}$/.test(formStart)}
              title={!formTitle.trim() ? t.addTitle : (formStart ? '' : (lang === 'en' ? 'Pick a start time first' : 'اختار وقت البدء الأول'))}
              className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-all"
            >
              {t.addBtn}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setFormTitle(''); }}
              className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 cursor-pointer transition-all"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full mt-3 py-3 rounded-2xl border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40 bg-white/[0.03] font-semibold text-[13px] cursor-pointer transition-colors"
        >
          {lang === 'en' ? '+ Add a task' : '+ ضيف مهمة'}
        </button>
      )}
    </div>
  );
}

const TAG_ICON = {
  wake: Sun,
  work: Briefcase,
  study: BookOpen,
  rest: Coffee,
  meal: Pizza,
  prayer: MapPin,
  gym: Dumbbell,
  store: Package,
  read: BookOpen,
  dev: Code2,
  sleep: Moon,
};

// Display order for the type picker: the everyday activity types first.
const TAG_ORDER = ['work', 'study', 'rest', 'gym', 'dev', 'prayer', 'meal', 'read', 'sleep', 'wake', 'store'];

function TagPicker({ value, onSelect }) {
  const [open, setOpen] = useState(false);
  const current = TAGS[value] || TAGS.rest;
  const Icon = TAG_ICON[value] || Coffee;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer"
        style={{
          background: `linear-gradient(135deg, ${current.c}2e, ${current.c}12)`,
          border: `1px solid ${current.c}66`,
          color: '#fff',
          boxShadow: `0 0 12px -3px ${current.c}`,
        }}
      >
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <Icon size={15} style={{ color: current.c }} />
          <span style={{ color: '#eee' }}>{current.label}</span>
        </span>
        <ChevronDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} style={{ color: 'rgba(255,255,255,0.6)' }} />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 mt-1.5 w-full rounded-2xl overflow-hidden backdrop-blur-xl"
          style={{
            background: 'rgba(20,16,38,0.85)',
            border: '1px solid rgba(167,139,250,0.35)',
            boxShadow: '0 0 26px -6px rgba(167,139,250,0.55), 0 18px 40px -12px rgba(0,0,0,0.6)',
          }}
        >
          <div className="max-h-56 overflow-y-auto no-scrollbar">
            {TAG_ORDER.map((key) => {
              const tag = TAGS[key];
              if (!tag) return null;
              const I = TAG_ICON[key] || Coffee;
              const active = value === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { onSelect(key); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-right transition-colors cursor-pointer ${
                    active ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                  style={{ color: active ? '#fff' : 'rgba(255,255,255,0.75)' }}
                >
                  <span
                    className="grid place-items-center w-7 h-7 rounded-lg"
                    style={{ background: `${tag.c}22`, border: `1px solid ${tag.c}55`, boxShadow: active ? `0 0 8px -2px ${tag.c}` : 'none' }}
                  >
                    <I size={14} style={{ color: tag.c }} />
                  </span>
                  <span className="flex-1">{tag.label}</span>
                  {active && <span className="text-[11px] font-bold" style={{ color: tag.c }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ num, it, color, Icon, done, isNow, lang, t, onChangeTitle, onChangeStart, onChangeEnd, onChangeTag, onToggle, showEdit, onRemove }) {
  const [open, setOpen] = useState(false);
  const tagLabel = TAGS[it.tag]?.label || '';
  return (
    <div
      className={`glass rounded-2xl px-3.5 py-3 transition-all group ${
        done ? 'opacity-50' : 'hover:-translate-y-0.5'
      } ${isNow ? 'now-ring' : ''}`}
      style={isNow ? { boxShadow: '0 0 0 1px var(--neon), 0 0 22px -8px var(--neon)' } : {}}
    >
      <div className="flex items-center gap-3">
        <span
          className="shrink-0 grid place-items-center w-6 h-6 rounded-lg select-none"
          style={{
            background: 'linear-gradient(135deg, rgba(167,139,250,0.35), rgba(167,139,250,0.12))',
            border: '1px solid rgba(167,139,250,0.45)',
            color: '#d8ccff',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {num}
        </span>
        <button
          onClick={onToggle}
          aria-label={done ? t.toggleUndone : t.toggleDone}
          title={done ? t.toggleUndone : t.toggleDone}
          className={`shrink-0 grid place-items-center w-6 h-6 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
            done
              ? 'bg-emerald-500 border-emerald-400 text-white span-check'
              : 'border-white/20 text-transparent hover:border-white/50 hover:scale-110'
          }`}
        >
          <Check size={14} strokeWidth={3.5} />
        </button>

        <div className="w-11 h-11 shrink-0 rounded-2xl grid place-items-center transition-transform group-hover:scale-105"
          style={{ background: `linear-gradient(135deg, ${color}2e, ${color}14)`, border: `1px solid ${color}66`, boxShadow: `0 0 12px -4px ${color}` }}
        >
          <Icon size={20} style={{ color }} strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <div className={`text-[14px] leading-snug ${done ? 'text-gray-400 line-through' : 'text-gray-100 font-semibold'}`}>{it.title}</div>
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
            {tagLabel && (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: `${color}1c`, color, border: `1px solid ${color}55` }}
              >
                <Icon size={11} style={{ color }} />
                {tagLabel}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-black/30 border border-white/10 text-gray-300">
              <Clock size={11} className="text-white/40" />
              <span dir="ltr">{fmt12(it.start, lang)}</span>
              {it.end && <span dir="ltr" className="text-gray-500">→ {fmt12(it.end, lang)}</span>}
            </span>
          </div>
        </div>

        {showEdit && (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={t.edit}
            title={t.edit}
            className={`shrink-0 p-2 rounded-xl transition-colors cursor-pointer ${
              open ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5 text-[13px]">
          <div className="col-span-2 flex items-center gap-2 text-white/80 font-semibold">
            <Pencil size={13} /> {t.editTitle}
          </div>
          <input
            className="col-span-2 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/10 transition-shadow"
            defaultValue={it.title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder={t.titlePlaceholder}
          />
          <label className="text-[11px] text-gray-400 col-span-2 -mb-1">{t.timeLabel}</label>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={13} /> {t.start}
            <input
              type="time"
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white tabular-nums focus:border-white/50 focus:outline-none"
              value={it.start}
              onChange={(e) => onChangeStart(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={13} /> {t.end}
            <input
              type="time"
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white tabular-nums focus:border-white/50 focus:outline-none"
              value={it.end || ''}
              onChange={(e) => onChangeEnd(e.target.value || null)}
            />
          </div>
          <label className="text-[11px] text-gray-400 col-span-2 -mb-0.5">{t.addType}</label>
          <div className="col-span-2">
            <TagPicker value={it.tag} onSelect={onChangeTag} />
          </div>
          <button onClick={() => setOpen(false)} className="col-span-2 mt-1.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold cursor-pointer transition-all">{t.saveEdit}</button>
          <button
            onClick={() => { setOpen(false); onRemove(); }}
            className="col-span-2 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 text-red-300 font-semibold text-[12px] cursor-pointer transition-all"
          >
            {lang === 'en' ? 'Delete task' : 'حذف المهمة'}
          </button>
        </div>
      )}
    </div>
  );
}