import {
  h, icon, iconBtn, store, getSettings, setSetting, applyTheme, todayKey, sheet, closeAllSheets,
  getStreak, toast, backupNow, listBackups, autoBackup, restoreBackup, exportSave, importSave, describeBackup,
} from './core.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const actionsEl = document.getElementById('actions');
const backBtn = document.getElementById('backBtn');

let cleanup = null;
let cameFromHome = false;

export const ui = {
  setTitle(t) { titleEl.replaceChildren(t); },
  setActions(nodes) { actionsEl.replaceChildren(...nodes.filter(Boolean)); },
  go(hash, { replace = false } = {}) {
    if (replace) { history.replaceState(null, '', hash); route(); }
    else location.hash = hash;
  },
};

backBtn.addEventListener('click', goHome);
function goHome() {
  if (cameFromHome) history.back();
  else { history.replaceState(null, '', '#/'); route(); }
}

const GAMES = {
  wordle: { name: 'Word Guess', color: 'var(--wordle)', load: () => import('./wordle.js') },
  sudoku: { name: 'Sudoku', color: 'var(--sudoku)', load: () => import('./sudoku.js') },
  crossword: { name: 'Crossword', color: 'var(--cross)', load: () => import('./crossword.js') },
  keystone: { name: 'Keystone', color: 'var(--idle)', load: () => import('./keystone.js') },
};

async function route() {
  closeAllSheets();
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  view.replaceChildren();
  actionsEl.replaceChildren();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page, ...rest] = parts;
  backBtn.hidden = !page;
  if (!page) { cameFromHome = true; return renderHome(); }
  if (page === 'settings') return renderSettings();
  const g = GAMES[page];
  if (!g) { history.replaceState(null, '', '#/'); return route(); }
  ui.setTitle(g.name);
  try {
    const mod = await g.load();
    cleanup = mod.mount(view, rest, ui) || null;
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'loading' }, 'Something went wrong loading this puzzle.'));
  }
}
window.addEventListener('hashchange', route);

// ---------- Home ----------
const ART = {
  keystone: '<svg viewBox="0 0 40 40"><polygon points="20,11 28,15.5 28,24.5 20,29 12,24.5 12,15.5" fill="#fff"/><polygon points="20,16 24,23 16,23" fill="#1f9e93"/><rect x="4" y="5" width="6" height="6" rx="1" fill="#fff" opacity=".7" transform="rotate(20 7 8)"/><polygon points="33,4 37,11 29,11" fill="#fff" opacity=".7"/><polygon points="33,30 37,33 35.5,37.5 30.5,37.5 29,33" fill="#fff" opacity=".7"/></svg>',
  wordle: '<svg viewBox="0 0 40 40" fill="none"><rect x="3" y="12" width="10" height="10" rx="2" fill="#fff"/><rect x="15" y="12" width="10" height="10" rx="2" fill="#fff" opacity=".55"/><rect x="27" y="12" width="10" height="10" rx="2" fill="#fff" opacity=".85"/><rect x="3" y="25" width="10" height="4" rx="2" fill="#fff" opacity=".4"/><rect x="15" y="25" width="10" height="4" rx="2" fill="#fff" opacity=".4"/><rect x="27" y="25" width="10" height="4" rx="2" fill="#fff" opacity=".4"/></svg>',
  sudoku: '<svg viewBox="0 0 40 40" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="5" width="30" height="30" rx="4"/><path d="M15 5v30M25 5v30M5 15h30M5 25h30" opacity=".5"/><text x="10" y="13.5" font-size="8" fill="#fff" stroke="none" text-anchor="middle" font-weight="700" font-family="sans-serif">3</text><text x="30" y="23.5" font-size="8" fill="#fff" stroke="none" text-anchor="middle" font-weight="700" font-family="sans-serif">7</text><text x="20" y="33.5" font-size="8" fill="#fff" stroke="none" text-anchor="middle" font-weight="700" font-family="sans-serif">5</text></svg>',
  crossword: '<svg viewBox="0 0 40 40"><g fill="#fff"><rect x="5" y="5" width="9" height="9" rx="1.5"/><rect x="15.5" y="5" width="9" height="9" rx="1.5"/><rect x="26" y="5" width="9" height="9" rx="1.5" opacity=".3"/><rect x="5" y="15.5" width="9" height="9" rx="1.5" opacity=".3"/><rect x="15.5" y="15.5" width="9" height="9" rx="1.5"/><rect x="26" y="15.5" width="9" height="9" rx="1.5"/><rect x="5" y="26" width="9" height="9" rx="1.5"/><rect x="15.5" y="26" width="9" height="9" rx="1.5"/><rect x="26" y="26" width="9" height="9" rx="1.5" opacity=".3"/></g></svg>',
};

function dailyStatus(game) {
  const today = todayKey();
  const s = getSettings();
  if (game === 'wordle') {
    const d = store.get('wordle:daily');
    if (d && d.date === today) {
      if (d.status === 'won') return { done: true, text: `Solved in ${d.guesses.length}/6` };
      if (d.status === 'lost') return { done: true, text: 'Better luck tomorrow' };
      if (d.guesses.length) return { text: `In progress · ${d.guesses.length}/6` };
    }
    return { text: 'Guess the 5-letter word in 6 tries' };
  }
  if (game === 'sudoku') {
    const d = store.get('sudoku:daily');
    const diff = s.sudokuDaily[0].toUpperCase() + s.sudokuDaily.slice(1);
    if (d && d.date === today && d.difficulty === s.sudokuDaily) {
      if (d.status === 'won') return { done: true, text: `${diff} · solved` };
      return { text: `${diff} · in progress` };
    }
    return { text: `Daily ${diff.toLowerCase()} puzzle` };
  }
  const d = store.get('cw:daily');
  const n = s.cwDailySize;
  if (d && d.date === today && d.size === n) {
    if (d.status === 'won') return { done: true, text: `${n}×${n} · solved` };
    return { text: `${n}×${n} · in progress` };
  }
  return { text: `Daily ${n}×${n} grid` };
}

function renderHome() {
  ui.setTitle('Puzzle Box');
  ui.setActions([iconBtn('gear', 'Settings', () => ui.go('#/settings'))]);
  const now = new Date();
  const wrap = h('div', { class: 'home' },
    h('p', { class: 'home-date' }, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
  );
  for (const key of ['wordle', 'sudoku', 'crossword']) {
    const g = GAMES[key];
    const st = dailyStatus(key);
    const streak = getStreak(key);
    const dailyBtn = h('button', { class: 'btn btn-primary' + (st.done ? ' done' : ''), style: { '--c': g.color }, onclick: () => ui.go(`#/${key}/daily`) },
      st.done ? icon('check') : null, st.done ? 'Daily done' : 'Play daily');
    const practiceBtn = h('button', { class: 'btn btn-soft', onclick: () => openPractice(key) }, practiceLabel(key));
    wrap.append(h('section', { class: 'game-card', style: { '--c': g.color } },
      h('div', { class: 'game-icon', style: { background: g.color }, html: ART[key] }),
      h('h2', {}, g.name),
      h('div', { class: 'sub' }, st.text, streak.cur > 0 ? ` · 🔥 ${streak.cur}` : ''),
      h('div', { class: 'card-actions' }, dailyBtn, practiceBtn),
    ));
  }
  // idle game
  {
    const m = store.get('ks:meta', {});
    const r = store.get('ks:run');
    wrap.append(h('div', { class: 'section-label' }, 'Idle'));
    wrap.append(h('section', { class: 'game-card', style: { '--c': 'var(--idle)' } },
      h('div', { class: 'game-icon', style: { background: 'var(--idle)' }, html: ART.keystone }),
      h('h2', {}, 'Keystone'),
      h('div', { class: 'sub' }, m.bestWave ? `Tier ${m.maxTier || 1} · best wave ${(m.best && m.best[m.maxTier || 1]) || m.bestWave}` : 'Idle tower defense with shapes'),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), r ? `Resume · W${r.wave}` : 'Start run'),
        h('button', { class: 'btn btn-soft', onclick: () => ui.go('#/keystone') }, 'Workshop'))));
  }
  wrap.append(h('div', { class: 'section-label' }, 'Daily streaks'));
  wrap.append(h('div', { class: 'streaks' }, ...['wordle', 'sudoku', 'crossword'].map((k) => {
    const s = getStreak(k);
    return h('div', { class: 'streak' }, h('b', {}, String(s.cur)), h('span', {}, `${GAMES[k].name} · best ${s.best}`));
  })));
  view.append(wrap);
}

function practiceLabel(key) {
  if (key === 'wordle') {
    const p = store.get('wordle:practice');
    return p && p.status === 'playing' && p.guesses.length ? 'Continue' : 'Unlimited';
  }
  const p = store.get(key === 'sudoku' ? 'sudoku:practice' : 'cw:practice');
  return p && p.status === 'playing' ? 'Continue' : 'New puzzle';
}

function openPractice(key) {
  if (key === 'wordle') return ui.go('#/wordle/practice');
  const p = store.get(key === 'sudoku' ? 'sudoku:practice' : 'cw:practice');
  if (p && p.status === 'playing') return ui.go(`#/${key}/practice`);
  if (key === 'sudoku') pickSudoku((d) => ui.go(`#/sudoku/new/${d}`));
  else pickCrossword((n) => ui.go(`#/crossword/new/${n}`));
}

// ---------- Pickers (also used by games) ----------
export function pickSudoku(onPick) {
  let diff = getSettings().sudokuNew;
  const levels = ['easy', 'medium', 'hard', 'expert'];
  const chips = h('div', { class: 'chips', style: { '--c': 'var(--sudoku)' } });
  const draw = () => chips.replaceChildren(...levels.map((l) => h('button', { class: 'chip', 'aria-pressed': String(l === diff), onclick: () => { diff = l; draw(); } }, l[0].toUpperCase() + l.slice(1))));
  draw();
  const close = sheet('New Sudoku', h('div', {}, chips,
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', style: { '--c': 'var(--sudoku)' }, onclick: () => { setSetting('sudokuNew', diff); close(); onPick(diff); } }, 'Start'))));
}

export function pickCrossword(onPick) {
  let n = getSettings().cwNewSize;
  const out = h('output', {});
  const hint = h('p', { class: 'hint' });
  const draw = () => {
    out.textContent = `${n} × ${n}`;
    hint.textContent = n <= 5 ? 'Mini · a couple of minutes' : n <= 9 ? 'Midi · a relaxed coffee break' : n <= 12 ? 'Daily-paper size' : 'Full size · settle in';
  };
  draw();
  const step = (d) => { n = Math.max(4, Math.min(15, n + d)); draw(); };
  const presets = h('div', { class: 'chips', style: { marginTop: '14px', '--c': 'var(--cross)' } },
    ...[5, 7, 9, 11, 13, 15].map((v) => h('button', { class: 'chip', onclick: () => { n = v; draw(); } }, `${v}×${v}`)));
  const close = sheet('New Crossword', h('div', {},
    h('div', { class: 'stepper' }, h('button', { onclick: () => step(-1), 'aria-label': 'Smaller' }, '−'), out, h('button', { onclick: () => step(1), 'aria-label': 'Bigger' }, '+')),
    hint, presets,
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', style: { '--c': 'var(--cross)' }, onclick: () => { setSetting('cwNewSize', n); close(); onPick(n); } }, 'Build puzzle'))));
}

// ---------- Settings ----------
function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const draw = (v) => el.replaceChildren(...options.map(([val, label]) => h('button', { 'aria-pressed': String(val === v), onclick: () => { onChange(val); draw(val); } }, label)));
  draw(value);
  return el;
}
function toggle(value, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}
function miniStep(value, min, max, fmt, onChange) {
  let v = value;
  const out = h('output', {}, fmt(v));
  const set = (d) => { v = Math.max(min, Math.min(max, v + d)); out.textContent = fmt(v); onChange(v); };
  return h('div', { class: 'mini-step' }, h('button', { onclick: () => set(-1), 'aria-label': 'Decrease' }, '−'), out, h('button', { onclick: () => set(1), 'aria-label': 'Increase' }, '+'));
}
function item(label, sub, control) {
  return h('div', { class: 'set-item' }, h('div', { class: 'lbl' }, label, sub ? h('small', {}, sub) : null), control);
}

function renderSettings() {
  ui.setTitle('Settings');
  const s = getSettings();
  const sz = (n) => `${n}×${n}`;
  const wrap = h('div', { class: 'settings' },
    h('div', { class: 'section-label' }, 'Appearance'),
    h('div', { class: 'set-group' },
      item('Theme', null, seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => setSetting('theme', v))),
      item('Show timers', null, toggle(s.showTimer, (v) => setSetting('showTimer', v))),
      item('Vibration', 'Light haptic feedback on key taps', toggle(s.haptics, (v) => setSetting('haptics', v))),
    ),
    h('div', { class: 'section-label' }, 'Crossword'),
    h('div', { class: 'set-group' },
      item('Daily puzzle size', 'Changes today’s daily grid too', miniStep(s.cwDailySize, 4, 15, sz, (v) => setSetting('cwDailySize', v))),
      item('Flag wrong letters', 'Mark a letter red as soon as it’s wrong. Turn off to fill in freely and check yourself.', toggle(s.cwAutoCheck, (v) => setSetting('cwAutoCheck', v))),
      item('New puzzle size', 'Default when you start a new one', miniStep(s.cwNewSize, 4, 15, sz, (v) => setSetting('cwNewSize', v))),
    ),
    h('div', { class: 'section-label' }, 'Sudoku'),
    h('div', { class: 'set-group' },
      item('Daily difficulty', null, seg([['easy', 'Easy'], ['medium', 'Med'], ['hard', 'Hard'], ['expert', 'Exp']], s.sudokuDaily, (v) => setSetting('sudokuDaily', v))),
      item('Flag mistakes', 'Show wrong numbers in red right away', toggle(s.sudokuCheck, (v) => setSetting('sudokuCheck', v))),
    ),
    h('div', { class: 'section-label' }, 'Word Guess'),
    h('div', { class: 'set-group' },
      item('Hard mode', 'Revealed hints must be used in later guesses', toggle(s.hardMode, (v) => setSetting('hardMode', v))),
    ),
    h('div', { class: 'section-label' }, 'Save data'),
    h('div', { class: 'set-group' },
      item('Export save', 'Copy your whole save as text to keep somewhere safe', h('button', { class: 'btn btn-outline', style: { flex: 'none' }, onclick: () => showExport() }, 'Export')),
      item('Import save', 'Paste a saved text to restore it', h('button', { class: 'btn btn-outline', style: { flex: 'none' }, onclick: showImport }, 'Import')),
      item('Backups on this phone', 'Made automatically each day and before updates', h('button', { class: 'btn btn-outline', style: { flex: 'none' }, onclick: showBackups }, 'View')),
    ),
    h('div', { class: 'section-label' }, 'Danger zone'),
    h('div', { class: 'set-group' },
      item(h('span', { class: 'danger' }, 'Reset all progress'), 'Clears stats, streaks and saved games', h('button', { class: 'btn btn-outline', style: { flex: 'none' }, onclick: confirmReset }, 'Reset')),
    ),
    h('p', { class: 'hint' }, 'Puzzle Box · works offline once installed'),
  );
  view.append(wrap);
}

function confirmReset() {
  const close = sheet('Reset everything?', h('div', {},
    h('p', { style: { textAlign: 'center', color: 'var(--muted)' } }, 'This erases all stats, streaks and games in progress. Your settings are kept.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-soft', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', style: { '--c': 'var(--wrong)' }, onclick: () => {
        backupNow('before reset');
        const keep = store.get('settings', {});
        try { Object.keys(localStorage).filter((k) => k.startsWith('pz:')).forEach((k) => localStorage.removeItem(k)); } catch {}
        store.set('settings', keep);
        close(); toast('Progress reset');
      } }, 'Reset'))));
}

// Bump with every release: the first launch after an update backs up the save on
// the phone and asks the player to export a copy somewhere safe.
const APP_VERSION = '2026.11.25-5';
function checkUpdate() {
  const prev = store.get('appVersion', null);
  if (prev === APP_VERSION) return;
  backupNow(prev ? `before update ${APP_VERSION}` : 'first launch of this version');
  store.set('appVersion', APP_VERSION);
  setTimeout(() => showExport(true), 700);
}

function showExport(afterUpdate = false) {
  const text = exportSave();
  const ta = h('textarea', { class: 'save-text', readonly: true }, text);
  const close = sheet(afterUpdate ? 'Puzzle Box was updated' : 'Export save', h('div', {},
    afterUpdate ? h('p', { style: { textAlign: 'left', margin: '0 0 8px' } }, 'A backup was saved on this phone. To be completely safe, copy your save and keep it somewhere off the phone, such as a note or an email to yourself.') : null,
    h('p', { class: 'hint', style: { textAlign: 'left' } }, 'This text is your entire save: all games, stats and Keystone progress. Keep it in a note, an email to yourself, or a file.'),
    ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-soft', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Save copied'); } catch { ta.select(); document.execCommand('copy'); toast('Save copied'); }
      } }, 'Copy'),
      h('button', { class: 'btn btn-primary', onclick: () => {
        const blob = new Blob([text], { type: 'text/plain' });
        const file = new File([blob], `puzzle-box-save-${new Date().toISOString().slice(0, 10)}.txt`, { type: 'text/plain' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Puzzle Box save' }).catch(() => {});
        else { const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove(); }
        void close;
      } }, 'Save as file')),
    afterUpdate ? h('button', { class: 'btn btn-outline', style: { width: '100%', marginTop: '10px' }, onclick: () => close() }, 'Not now') : null));
}
function showImport() {
  const ta = h('textarea', { class: 'save-text', placeholder: 'Paste your save text here' });
  const fileIn = h('input', { type: 'file', accept: '.txt,text/plain', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (f) ta.value = await f.text(); });
  const close = sheet('Import save', h('div', {},
    h('p', { class: 'hint', style: { textAlign: 'left' } }, 'This replaces everything on this phone with the imported save. Your current data is backed up first, so you can undo from Backups.'),
    ta, fileIn,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-soft', onclick: () => fileIn.click() }, 'Choose file'),
      h('button', { class: 'btn btn-primary', onclick: () => {
        try { importSave(ta.value); close(); toast('Save imported'); setTimeout(() => location.reload(), 600); }
        catch (e) { toast(e.message || 'Could not import that save', 2600); }
      } }, 'Import'))));
}
function showBackups() {
  const list = listBackups();
  const close = sheet('Backups', h('div', {},
    h('p', { class: 'hint', style: { textAlign: 'left' } }, 'The last 7 backups are kept on this phone. Restoring backs up your current data first.'),
    list.length ? h('div', { class: 'set-group' }, ...list.map((b) => h('div', { class: 'set-item' },
      h('div', { class: 'lbl' }, new Date(b.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        h('small', {}, `${b.reason} · ${describeBackup(b.data)}`)),
      h('button', { class: 'btn btn-outline', style: { flex: 'none' }, onclick: () => { restoreBackup(b.key); close(); toast('Backup restored'); setTimeout(() => location.reload(), 600); } }, 'Restore'))))
      : h('p', { class: 'hint' }, 'No backups yet.'),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-soft', onclick: () => { backupNow('manual'); close(); toast('Backup made'); } }, 'Back up now'))));
}

// ---------- Boot ----------
try { autoBackup(); checkUpdate(); } catch {}
// Ask the phone to keep this app's data permanently (not cleared when storage runs low).
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()); } catch {}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
