// Shared helpers: storage, settings, dates, DOM, toasts, sheets.

const P = 'pz:';
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(P + k); } catch {} },
};

export const DEFAULT_SETTINGS = {
  theme: 'system',          // system | light | dark
  cwDailySize: 5,           // daily crossword size
  cwNewSize: 5,             // default size for "new crossword"
  sudokuDaily: 'medium',    // daily sudoku difficulty
  sudokuNew: 'medium',
  sudokuCheck: true,        // highlight wrong numbers immediately
  hardMode: false,          // wordle hard mode
  haptics: true,
  showTimer: true,
  cwAutoCheck: true,        // crossword: flag wrong letters as you type
};
export function getSettings() { return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) }; }
export function setSetting(k, v) {
  const s = getSettings(); s[k] = v; store.set('settings', s);
  if (k === 'theme') applyTheme();
}
export function applyTheme() {
  const t = getSettings().theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#111318' : '#f6f3ee'));
}

export function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function dayNumber(key = todayKey()) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000);
}
export function yesterdayKey(key = todayKey()) {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

export const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  erase: '<path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L12 20"/><path d="M8 11l6 6"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
  dots: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  backspace: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-6 6M11 9l6 6"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12M7 8l5-5 5 5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || '';
  return s;
}
export function iconBtn(name, label, onclick) {
  return h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick }, icon(name));
}

export function toast(msg, ms = 1600) {
  const t = h('div', { class: 'toast' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function haptic(ms = 10) {
  if (getSettings().haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// Bottom sheet. Returns close().
let openSheets = [];
export function sheet(title, content, { onClose } = {}) {
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }), title ? h('h3', {}, title) : null, content);
  const scrim = h('div', { class: 'scrim' }, box);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    scrim.remove(); openSheets = openSheets.filter((c) => c !== close);
    onClose && onClose();
  };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  openSheets.push(close);
  return close;
}
export function closeAllSheets() { [...openSheets].forEach((c) => c()); }
export function sheetOpen() { return openSheets.length > 0; }

// Simple game timer that pauses when the app is hidden.
export function makeTimer(initial, onTick) {
  let elapsed = initial || 0, last = null, iv = null, running = false;
  const tick = () => { const now = performance.now(); if (last != null) elapsed += (now - last) / 1000; last = now; onTick(elapsed); };
  const vis = () => { if (document.hidden) { if (running) { tick(); last = null; } } else if (running) last = performance.now(); };
  document.addEventListener('visibilitychange', vis);
  return {
    start() { if (running) return; running = true; last = performance.now(); iv = setInterval(tick, 500); onTick(elapsed); },
    stop() { if (!running) return; tick(); running = false; clearInterval(iv); last = null; },
    get() { if (running && last != null) { const now = performance.now(); elapsed += (now - last) / 1000; last = now; } return elapsed; },
    destroy() { this.stop(); document.removeEventListener('visibilitychange', vis); },
  };
}

// On-screen QWERTY keyboard.
export function keyboard(onKey, { enter = true } = {}) {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const keys = {};
  const el = h('div', { class: 'kb' });
  rows.forEach((r, ri) => {
    const row = h('div', { class: 'kb-row' });
    if (ri === 1) row.append(h('div', { class: 'kb-spacer' }));
    if (ri === 2 && enter) row.append(h('button', { class: 'kb-key wide', 'data-key': 'enter' }, 'Enter'));
    if (ri === 2 && !enter) row.append(h('div', { class: 'kb-spacer' }));
    for (const ch of r) { const k = h('button', { class: 'kb-key', 'data-key': ch }, ch); keys[ch] = k; row.append(k); }
    if (ri === 1) row.append(h('div', { class: 'kb-spacer' }));
    if (ri === 2) row.append(h('button', { class: 'kb-key wide', 'data-key': 'back', 'aria-label': 'Backspace' }, icon('backspace')));
    el.append(row);
  });
  // pointerdown for snappy response; prevent focus/zoom
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.kb-key');
    if (!b) return;
    e.preventDefault();
    haptic(8);
    onKey(b.dataset.key);
  });
  return {
    el,
    setState(ch, st) { if (keys[ch]) keys[ch].dataset.state = st; },
    reset() { Object.values(keys).forEach((k) => delete k.dataset.state); },
  };
}

// Daily streaks shared by all games.
export function recordDaily(game, date, won) {
  const s = store.get('streak:' + game, { cur: 0, best: 0, last: null, wins: 0 });
  if (s.last === date || s.lastLoss === date) return s;
  if (won) {
    s.cur = s.last === yesterdayKey(date) ? s.cur + 1 : 1;
    s.best = Math.max(s.best, s.cur);
    s.last = date;
    s.wins = (s.wins || 0) + 1;
  } else { s.cur = 0; s.lastLoss = date; }
  store.set('streak:' + game, s);
  return s;
}
export function getStreak(game) {
  const s = store.get('streak:' + game, { cur: 0, best: 0, last: null, wins: 0 });
  if (s.last !== todayKey() && s.last !== yesterdayKey()) s.cur = 0;
  return s;
}
export function recordBest(key, seconds) {
  const b = store.get('best', {});
  const prev = b[key];
  if (prev == null || seconds < prev) { b[key] = Math.round(seconds); store.set('best', b); return true; }
  return false;
}
export function getBest(key) { return store.get('best', {})[key]; }

// ---------- Save backups, export & import ----------
// Every key the app stores starts with "pz:". Backups are full copies kept on
// this device ("pzbak:<time>"); export/import moves them anywhere as text.
const BAK = 'pzbak:';
const KEEP_BACKUPS = 7;
function snapshotAll() {
  const data = {};
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(P)) data[k] = localStorage.getItem(k); } catch {}
  return data;
}
export function backupNow(reason = 'manual') {
  try {
    const t = Date.now();
    localStorage.setItem(BAK + t, JSON.stringify({ t, reason, data: snapshotAll() }));
    const keys = listBackups().map((b) => b.key);
    for (const k of keys.slice(KEEP_BACKUPS)) localStorage.removeItem(k);
    return true;
  } catch { return false; }
}
export function listBackups() {
  const out = [];
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(BAK)) continue;
      try { const b = JSON.parse(localStorage.getItem(k)); out.push({ key: k, t: b.t, reason: b.reason, data: b.data }); } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.t - a.t);
}
// one automatic backup per ~20 hours
export function autoBackup() {
  const last = listBackups()[0];
  if (!last || Date.now() - last.t > 20 * 3600 * 1000) backupNow('daily');
}
function replaceAll(data) {
  for (const k of Object.keys(localStorage)) if (k.startsWith(P)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(data)) if (k.startsWith(P)) localStorage.setItem(k, v);
}
export function restoreBackup(key) {
  const b = listBackups().find((x) => x.key === key);
  if (!b) return false;
  backupNow('before restore');
  replaceAll(b.data);
  return true;
}
export function exportSave() {
  return 'PUZZLEBOX1:' + btoa(unescape(encodeURIComponent(JSON.stringify({ t: Date.now(), data: snapshotAll() }))));
}
export function importSave(text) {
  const s = String(text || '').trim();
  if (!s.startsWith('PUZZLEBOX1:')) throw new Error('That doesn’t look like a Puzzle Box save.');
  const obj = JSON.parse(decodeURIComponent(escape(atob(s.slice(11)))));
  if (!obj || typeof obj.data !== 'object') throw new Error('The save text is damaged.');
  backupNow('before import');
  replaceAll(obj.data);
  return obj.t;
}
// short description of a backup for the list
export function describeBackup(data) {
  try {
    const m = JSON.parse(data['pz:ks:meta'] || 'null');
    if (m) return `Keystone tier ${m.maxTier || 1} · ${Math.floor(m.shards || 0).toLocaleString()} shards · ${m.runs || 0} runs`;
  } catch {}
  return `${Object.keys(data).length} saved items`;
}
