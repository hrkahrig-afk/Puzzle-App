import { ANSWERS, GUESSES } from './data/words5.js';
import { mulberry32 } from './crossword-gen.js';
import {
  h, icon, iconBtn, store, getSettings, todayKey, dayNumber, keyboard, toast, sheet, haptic, recordDaily, getStreak,
} from './core.js';

const VALID = new Set([...ANSWERS, ...GUESSES]);
const ROWS = 6, LEN = 5;
const PRAISE = ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'];

// Daily order: a fixed shuffle so consecutive days aren't alphabetical.
let dailyOrder = null;
function dailyAnswer(date) {
  if (!dailyOrder) {
    dailyOrder = ANSWERS.slice();
    const r = mulberry32(20261124);
    for (let i = dailyOrder.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [dailyOrder[i], dailyOrder[j]] = [dailyOrder[j], dailyOrder[i]]; }
  }
  const n = dayNumber(date);
  return dailyOrder[((n % dailyOrder.length) + dailyOrder.length) % dailyOrder.length];
}

export function evaluate(guess, answer) {
  const res = Array(LEN).fill('absent');
  const counts = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) res[i] = 'correct';
    else counts[answer[i]] = (counts[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (res[i] === 'correct') continue;
    if (counts[guess[i]] > 0) { res[i] = 'present'; counts[guess[i]]--; }
  }
  return res;
}

function hardModeError(guess, history, answer) {
  for (const g of history) {
    const ev = evaluate(g, answer);
    for (let i = 0; i < LEN; i++) {
      if (ev[i] === 'correct' && guess[i] !== g[i]) return `${ordinal(i + 1)} letter must be ${g[i].toUpperCase()}`;
    }
    const need = {};
    for (let i = 0; i < LEN; i++) if (ev[i] !== 'absent') need[g[i]] = (need[g[i]] || 0) + 1;
    for (const [ch, n] of Object.entries(need)) {
      const have = [...guess].filter((c) => c === ch).length;
      if (have < n) return `Guess must contain ${ch.toUpperCase()}`;
    }
  }
  return null;
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n] || 'th');

const STATE_RANK = { absent: 1, present: 2, correct: 3 };

export function mount(view, params, ui) {
  const mode = params[0] === 'daily' ? 'daily' : 'practice';
  const today = todayKey();
  const key = mode === 'daily' ? 'wordle:daily' : 'wordle:practice';
  let st = store.get(key);
  if (mode === 'daily') {
    if (!st || st.date !== today) st = { date: today, guesses: [], status: 'playing' };
    st.answer = dailyAnswer(today);
  } else if (!st || st.status !== 'playing' || !st.answer) {
    st = newPractice();
  }
  let current = '';
  let busy = false;
  if (mode === 'practice') store.set(key, st);

  function newPractice() {
    return { answer: ANSWERS[Math.floor(Math.random() * ANSWERS.length)], guesses: [], status: 'playing' };
  }
  const save = () => store.set(key, mode === 'daily' ? { date: st.date, guesses: st.guesses, status: st.status } : st);

  ui.setTitle(h('span', {}, 'Word Guess', h('span', { class: 'mode-pill' }, mode === 'daily' ? `#${dayNumber(today) + 1}` : 'Unlimited')));
  ui.setActions([
    iconBtn('help', 'How to play', showHelp),
    iconBtn('chart', 'Statistics', () => showStats(false)),
    mode === 'practice' ? iconBtn('refresh', 'New word', () => {
      if (st.status === 'playing' && st.guesses.length) {
        const close = sheet('Start a new word?', h('div', {},
          h('p', { style: { textAlign: 'center', color: 'var(--muted)' } }, 'This counts as a loss for your unlimited stats.'),
          h('div', { class: 'row' }, h('button', { class: 'btn btn-soft', onclick: () => close() }, 'Keep playing'),
            h('button', { class: 'btn btn-primary', style: { '--c': 'var(--wordle)' }, onclick: () => { close(); toast(st.answer.toUpperCase(), 2200); finishStats(false); restart(); } }, 'New word'))));
      } else restart();
    }) : null,
  ]);

  // ----- DOM -----
  const rows = [];
  const board = h('div', { class: 'w-board' });
  for (let r = 0; r < ROWS; r++) {
    const row = h('div', { class: 'w-row' });
    const tiles = [];
    for (let c = 0; c < LEN; c++) { const t = h('div', { class: 'w-tile' }); tiles.push(t); row.append(t); }
    rows.push({ row, tiles });
    board.append(row);
  }
  const kb = keyboard(onKey);
  const root = h('div', { class: 'wordle' }, h('div', { class: 'w-board-wrap' }, board), kb.el);
  view.append(root);

  function paintAll() {
    kb.reset();
    rows.forEach(({ tiles }, r) => tiles.forEach((t) => { t.textContent = ''; delete t.dataset.state; t.className = 'w-tile'; }));
    st.guesses.forEach((g, r) => {
      const ev = evaluate(g, st.answer);
      rows[r].tiles.forEach((t, i) => { t.textContent = g[i]; t.dataset.state = ev[i]; });
      paintKeys(g, ev);
    });
    paintCurrent();
  }
  function paintKeys(g, ev) {
    for (let i = 0; i < LEN; i++) {
      const prev = kbStates[g[i]];
      if (!prev || STATE_RANK[ev[i]] > STATE_RANK[prev]) { kbStates[g[i]] = ev[i]; kb.setState(g[i], ev[i]); }
    }
  }
  const kbStates = {};
  function paintCurrent() {
    const r = st.guesses.length;
    if (r >= ROWS) return;
    rows[r].tiles.forEach((t, i) => {
      t.textContent = current[i] || '';
      t.classList.toggle('filled', !!current[i]);
    });
  }

  function restart() {
    st = newPractice();
    current = '';
    for (const k in kbStates) delete kbStates[k];
    save();
    paintAll();
  }

  function shake() {
    const r = rows[st.guesses.length].row;
    r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake');
    haptic(40);
  }

  function onKey(k) {
    if (busy || st.status !== 'playing') return;
    if (k === 'enter') return submit();
    if (k === 'back') { current = current.slice(0, -1); return paintCurrent(); }
    if (/^[a-z]$/.test(k) && current.length < LEN) { current += k; paintCurrent(); }
  }

  function submit() {
    if (current.length < LEN) { shake(); return toast('Not enough letters'); }
    if (!VALID.has(current)) { shake(); return toast('Not in word list'); }
    if (getSettings().hardMode) {
      const err = hardModeError(current, st.guesses, st.answer);
      if (err) { shake(); return toast(err); }
    }
    const guess = current;
    const r = st.guesses.length;
    const ev = evaluate(guess, st.answer);
    st.guesses.push(guess);
    current = '';
    const won = guess === st.answer;
    if (won) st.status = 'won';
    else if (st.guesses.length >= ROWS) st.status = 'lost';
    save();
    busy = true;
    const tiles = rows[r].tiles;
    tiles.forEach((t, i) => {
      t.classList.remove('filled');
      setTimeout(() => {
        t.classList.add('flip');
        setTimeout(() => { t.dataset.state = ev[i]; }, 250);
      }, i * 280);
    });
    setTimeout(() => {
      tiles.forEach((t) => t.classList.remove('flip'));
      paintKeys(guess, ev);
      busy = false;
      if (won) {
        tiles.forEach((t, i) => setTimeout(() => t.classList.add('bounce'), i * 90));
        toast(PRAISE[r], 1800);
        haptic(30);
        finishStats(true, r + 1);
        setTimeout(() => showStats(true), 1900);
      } else if (st.status === 'lost') {
        toast(st.answer.toUpperCase(), 3000);
        finishStats(false);
        setTimeout(() => showStats(true), 2200);
      }
    }, LEN * 280 + 300);
  }

  function statsKey() { return mode === 'daily' ? 'wordle:stats:daily' : 'wordle:stats:practice'; }
  function getStats() { return store.get(statsKey(), { played: 0, wins: 0, cur: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] }); }
  function finishStats(won, n) {
    const s = getStats();
    if (mode === 'daily' && s.lastDate === today) return;
    s.played++;
    if (won) { s.wins++; s.dist[n - 1]++; s.cur++; s.best = Math.max(s.best, s.cur); } else s.cur = 0;
    if (mode === 'daily') {
      s.lastDate = today;
      const sh = recordDaily('wordle', today, won);
      s.cur = sh.cur; s.best = Math.max(s.best, sh.best);
    }
    store.set(statsKey(), s);
  }

  function showStats(auto) {
    const s = getStats();
    if (mode === 'daily') { const sh = getStreak('wordle'); s.cur = sh.cur; }
    const maxD = Math.max(1, ...s.dist);
    const curRow = st.status === 'won' ? st.guesses.length - 1 : -1;
    const content = h('div', {},
      st.status !== 'playing' ? h('div', { class: 'big-result' }, st.status === 'won' ? 'Solved in' : 'The word was',
        h('b', {}, st.status === 'won' ? `${st.guesses.length} / 6` : st.answer.toUpperCase())) : null,
      h('div', { class: 'stats-row' },
        stat(s.played, 'Played'), stat(s.played ? Math.round((s.wins / s.played) * 100) : 0, 'Win %'),
        stat(s.cur, 'Streak'), stat(s.best, 'Best')),
      h('div', { class: 'menu-cap' }, 'Guess distribution'),
      h('div', { class: 'dist' }, ...s.dist.map((v, i) => h('div', { class: 'dist-row' }, h('span', {}, String(i + 1)),
        h('div', { class: 'dist-bar' + (i === curRow ? ' cur' : ''), style: { width: `${Math.max(8, (v / maxD) * 100)}%` } }, String(v))))),
    );
    const btns = h('div', { class: 'row' });
    if (st.status !== 'playing') btns.append(h('button', { class: 'btn btn-soft', onclick: share }, icon('share'), 'Share'));
    if (mode === 'practice' && st.status !== 'playing') btns.append(h('button', { class: 'btn btn-primary', style: { '--c': 'var(--wordle)' }, onclick: () => { close(); restart(); } }, 'Next word'));
    if (mode === 'daily' && st.status !== 'playing') {
      const cd = h('div', { class: 'hint', style: { marginTop: '14px' } });
      const tick = () => {
        const now = new Date(); const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const s2 = Math.floor((mid - now) / 1000);
        cd.textContent = `Next word in ${Math.floor(s2 / 3600)}h ${Math.floor((s2 % 3600) / 60)}m · or play Unlimited`;
      };
      tick();
      content.append(cd);
      btns.append(h('button', { class: 'btn btn-primary', style: { '--c': 'var(--wordle)' }, onclick: () => { close(); ui.go('#/wordle/practice'); } }, 'Play unlimited'));
    }
    if (btns.childNodes.length) content.append(btns);
    const close = sheet(mode === 'daily' ? 'Daily statistics' : 'Unlimited statistics', content);
  }
  const stat = (v, l) => h('div', {}, h('b', {}, String(v)), h('span', {}, l));

  async function share() {
    const emoji = { correct: '🟩', present: '🟨', absent: '⬜' };
    const lines = st.guesses.map((g) => evaluate(g, st.answer).map((e) => emoji[e]).join(''));
    const title = `Word Guess ${mode === 'daily' ? '#' + (dayNumber(today) + 1) : ''} ${st.status === 'won' ? st.guesses.length : 'X'}/6${getSettings().hardMode ? '*' : ''}`;
    const text = title + '\n\n' + lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    } catch {}
  }

  function showHelp() {
    const ex = (word, idx, state) => h('div', { class: 'help-ex' }, ...[...word].map((c, i) => h('div', { class: 'w-tile', 'data-state': i === idx ? state : null }, c)));
    sheet('How to play', h('div', {},
      h('p', {}, 'Guess the hidden 5-letter word in 6 tries. Each guess must be a real word. After each guess the tiles change colour:'),
      ex('CRANE', 0, 'correct'), h('p', {}, h('b', {}, 'C'), ' is in the word and in the right spot.'),
      ex('PILOT', 1, 'present'), h('p', {}, h('b', {}, 'I'), ' is in the word but in the wrong spot.'),
      ex('VAGUE', 3, 'absent'), h('p', {}, h('b', {}, 'U'), ' is not in the word.'),
      h('p', { class: 'hint' }, 'A new daily word appears at midnight. Unlimited mode lets you keep playing.')));
  }

  // physical keyboard
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.scrim')) return;
    if (e.key === 'Enter') onKey('enter');
    else if (e.key === 'Backspace') onKey('back');
    else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
  };
  window.addEventListener('keydown', onKeyDown);

  paintAll();
  if (st.status !== 'playing') setTimeout(() => showStats(true), 350);
  else if (!store.get('wordle:seenHelp')) { store.set('wordle:seenHelp', true); setTimeout(showHelp, 300); }

  return () => window.removeEventListener('keydown', onKeyDown);
}
