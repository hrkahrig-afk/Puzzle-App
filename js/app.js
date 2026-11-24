import {
  h, icon, iconBtn, store, getSettings, setSetting, applyTheme, todayKey, sheet, closeAllSheets,
  getStreak, toast,
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
    h('div', { class: 'section-label' }, 'Data'),
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
        const keep = store.get('settings', {});
        try { Object.keys(localStorage).filter((k) => k.startsWith('pz:')).forEach((k) => localStorage.removeItem(k)); } catch {}
        store.set('settings', keep);
        close(); toast('Progress reset');
      } }, 'Reset'))));
}

// ---------- Boot ----------
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
