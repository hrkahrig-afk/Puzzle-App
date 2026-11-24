import {
  h, icon, iconBtn, store, getSettings, todayKey, hashStr, fmtTime, toast, sheet, haptic, makeTimer, keyboard,
  recordDaily, recordBest, getBest,
} from './core.js';
import { pickCrossword } from './app.js';

let worker = null;
let reqId = 0;
const pending = new Map();
function generate(size, seed) {
  if (!worker) {
    worker = new Worker(new URL('./crossword-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.puzzle) p.resolve(e.data.puzzle); else p.reject(new Error(e.data.error || 'Could not build a puzzle'));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(e); pending.clear(); worker = null; };
  }
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, size, seed });
  });
}

export function mount(view, params, ui) {
  const settings = getSettings();
  const today = todayKey();
  const mode = params[0] === 'daily' ? 'daily' : 'practice';
  const key = mode === 'daily' ? 'cw:daily' : 'cw:practice';
  let destroyed = false;
  let cleanupGame = null;

  const loading = (msg) => view.replaceChildren(h('div', { class: 'loading' }, h('div', {}, h('div', { class: 'spinner' }), msg)));

  async function start() {
    let st = store.get(key);
    let size, seed;
    if (mode === 'daily') {
      size = settings.cwDailySize;
      if (st && st.date === today && st.size === size) return play(st);
      seed = hashStr(`cw:${today}:${size}`);
    } else if (params[0] === 'new') {
      size = Math.max(4, Math.min(15, parseInt(params[1], 10) || settings.cwNewSize));
      seed = (Math.random() * 2 ** 32) >>> 0;
    } else {
      if (st && st.puzzle) return play(st);
      size = settings.cwNewSize;
      seed = (Math.random() * 2 ** 32) >>> 0;
    }
    ui.setTitle(h('span', {}, 'Crossword', h('span', { class: 'mode-pill' }, `${size}×${size}`)));
    loading(`Building your ${size}×${size} puzzle…`);
    try {
      const puzzle = await generate(size, seed);
      if (destroyed) return;
      st = { size, puzzle, entries: Array(size * size).fill(''), revealed: [], wrong: [], elapsed: 0, status: 'playing' };
      if (mode === 'daily') st.date = today;
      store.set(key, st);
      if (params[0] === 'new') history.replaceState(null, '', '#/crossword/practice');
      play(st);
    } catch (e) {
      console.error(e);
      if (!destroyed) view.replaceChildren(h('div', { class: 'loading' }, h('div', {}, 'Could not build a puzzle.', h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } },
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--cross)', flex: 'none' }, onclick: start }, 'Try again')))));
    }
  }

  function play(st) {
    cleanupGame = game(view, st, key, mode, ui);
  }

  start();
  return () => { destroyed = true; cleanupGame && cleanupGame(); };
}

function game(view, st, key, mode, ui) {
  const settings = getSettings();
  const P = st.puzzle;
  const n = P.size;
  const N = n * n;
  const isBlock = (i) => P.grid[(i / n) | 0][i % n] === '#';
  const answer = (i) => P.grid[(i / n) | 0][i % n];

  // slots
  const slots = [];
  const cellSlot = { A: new Int16Array(N).fill(-1), D: new Int16Array(N).fill(-1) };
  for (const [dir, list] of [['A', P.across], ['D', P.down]]) {
    for (const e of list) {
      const cells = [];
      for (let k = 0; k < e.len; k++) cells.push(dir === 'A' ? e.row * n + e.col + k : (e.row + k) * n + e.col);
      const si = slots.length;
      slots.push({ ...e, dir, cells });
      cells.forEach((c) => (cellSlot[dir][c] = si));
    }
  }
  const revealed = new Set(st.revealed);
  const wrong = new Set(st.wrong || []);

  let sel = slots[0].cells[0];
  let dir = 'A';
  const firstEmpty = st.entries.findIndex((v, i) => !v && !isBlock(i));
  if (firstEmpty >= 0) { sel = firstEmpty; if (cellSlot.A[sel] < 0) dir = 'D'; }

  // ----- header -----
  const timerEl = h('span', { class: 'timer' });
  if (!settings.showTimer) timerEl.style.visibility = 'hidden';
  ui.setTitle(h('span', {}, 'Crossword', h('span', { class: 'mode-pill' }, `${mode === 'daily' ? 'Daily · ' : ''}${n}×${n}`)));
  ui.setActions([
    timerEl,
    iconBtn('list', 'All clues', showClueSheet),
    iconBtn('dots', 'Puzzle menu', showMenu),
  ]);
  const newPuzzle = () => pickCrossword((size) => ui.go(`#/crossword/new/${size}`, { replace: mode === 'practice' }));
  const timer = makeTimer(st.elapsed, (t) => { timerEl.textContent = fmtTime(t); });
  const save = () => {
    st.elapsed = timer.get();
    st.revealed = [...revealed];
    st.wrong = [...wrong];
    store.set(key, st);
  };

  // ----- grid -----
  const grid = h('div', { class: 'cw-grid' });
  const cells = [];
  for (let i = 0; i < N; i++) {
    const blk = isBlock(i);
    const num = P.numbers[i];
    const c = h('div', { class: 'cw-cell' + (blk ? ' block' : '') },
      !blk && num ? h('span', { class: 'n' }, String(num)) : null,
      blk ? null : h('span', { class: 'l' }));
    if (!blk) c.addEventListener('pointerdown', (e) => { e.preventDefault(); tapCell(i); });
    cells.push(c);
    grid.append(c);
  }

  // ----- clue list -----
  const clueEls = [];
  const acrossCol = h('div', {}, h('h4', {}, 'Across'));
  const downCol = h('div', {}, h('h4', {}, 'Down'));
  slots.forEach((s, si) => {
    const el = h('div', { class: 'cw-clue', onclick: () => jumpToSlot(si) }, h('b', {}, String(s.num)), h('span', {}, s.clue));
    clueEls.push(el);
    (s.dir === 'A' ? acrossCol : downCol).append(el);
  });
  const clueList = h('div', { class: 'cw-clues' }, acrossCol, downCol);

  // ----- bar + keyboard -----
  const barText = h('div', { class: 'cw-bar-text', onclick: () => toggleDir() });
  const bar = h('div', { class: 'cw-bar' }, iconBtn('left', 'Previous clue', () => moveSlot(-1)), barText, iconBtn('right', 'Next clue', () => moveSlot(1)));
  const kb = keyboard(onKey, { enter: false });

  const top = h('div', { class: 'cw-top' }, grid);
  const root = h('div', { class: 'cw' }, top, clueList, bar, kb.el);
  view.replaceChildren(root);

  // ----- sizing -----
  function fit() {
    const W = root.clientWidth - 16;
    const H = root.clientHeight - bar.offsetHeight - kb.el.offsetHeight - 24;
    // leave room for a few clue lines when possible
    const maxH = Math.max(H * 0.97 - 70, Math.min(H, W) * 0.6);
    const size = Math.max(16, Math.floor(Math.min(W, maxH) / n) - 1);
    grid.style.gridTemplateColumns = `repeat(${n}, ${size}px)`;
    grid.style.gridAutoRows = `${size}px`;
    grid.style.setProperty('--lfs', `${Math.round(size * 0.56)}px`);
    grid.style.setProperty('--nfs', `${Math.max(7, Math.round(size * 0.26))}px`);
  }
  const ro = new ResizeObserver(fit);
  ro.observe(root);

  // ----- helpers -----
  const curSlot = () => cellSlot[dir][sel];
  const slotFull = (si) => slots[si].cells.every((c) => st.entries[c]);
  function toggleDir() {
    const other = dir === 'A' ? 'D' : 'A';
    if (cellSlot[other][sel] >= 0) { dir = other; render(); }
  }
  function tapCell(i) {
    if (i === sel) toggleDir();
    else {
      sel = i;
      if (cellSlot[dir][sel] < 0) dir = dir === 'A' ? 'D' : 'A';
      render();
    }
  }
  function jumpToSlot(si) {
    const s = slots[si];
    dir = s.dir;
    sel = s.cells.find((c) => !st.entries[c]) ?? s.cells[0];
    render();
  }
  function moveSlot(d) {
    let si = curSlot();
    for (let k = 0; k < slots.length; k++) {
      si = (si + d + slots.length) % slots.length;
      if (!slotFull(si) || k === slots.length - 1) break;
    }
    // if every slot is full just step one
    if (slots.every((_, j) => slotFull(j))) si = (curSlot() + d + slots.length) % slots.length;
    jumpToSlot(si);
  }

  function onKey(k) {
    if (st.status !== 'playing') return;
    if (k === 'back') return backspace();
    if (!/^[a-z]$/.test(k)) return;
    const L = k.toUpperCase();
    if (!revealed.has(sel)) { st.entries[sel] = L; wrong.delete(sel); }
    advance();
    save();
    render();
    checkDone();
  }
  function advance() {
    const s = slots[curSlot()];
    const pos = s.cells.indexOf(sel);
    const after = s.cells.slice(pos + 1).find((c) => !st.entries[c]);
    const before = s.cells.slice(0, pos).find((c) => !st.entries[c]);
    if (after != null) sel = after;
    else if (allFilled()) { if (pos + 1 < s.cells.length) sel = s.cells[pos + 1]; }
    else if (before != null) sel = before;
    else moveSlot(1);
  }
  function backspace() {
    if (st.entries[sel] && !revealed.has(sel)) { st.entries[sel] = ''; wrong.delete(sel); }
    else {
      const s = slots[curSlot()];
      const pos = s.cells.indexOf(sel);
      if (pos > 0) sel = s.cells[pos - 1];
      else {
        const prev = slots[(curSlot() - 1 + slots.length) % slots.length];
        dir = prev.dir; sel = prev.cells[prev.cells.length - 1];
      }
      if (!revealed.has(sel)) { st.entries[sel] = ''; wrong.delete(sel); }
    }
    save();
    render();
  }

  const allFilled = () => { for (let i = 0; i < N; i++) if (!isBlock(i) && !st.entries[i]) return false; return true; };
  let warned = false;
  function checkDone() {
    if (!allFilled()) { warned = false; return; }
    let ok = true;
    for (let i = 0; i < N; i++) if (!isBlock(i) && st.entries[i] !== answer(i)) { ok = false; break; }
    if (ok) win();
    else if (!warned) { warned = true; toast('Almost! Some squares aren’t right', 2200); }
  }
  function win() {
    st.status = 'won';
    timer.stop();
    save();
    render();
    if (mode === 'daily') recordDaily('crossword', st.date, true);
    const isBest = revealed.size === 0 && recordBest(`cw:${n}`, st.elapsed);
    haptic(40);
    cells.forEach((c, i) => { if (!isBlock(i)) setTimeout(() => c.classList.add('ok'), ((i % n) + ((i / n) | 0)) * 40); });
    setTimeout(() => showWin(isBest), 900);
  }
  function showWin(isBest) {
    const best = getBest(`cw:${n}`);
    const close = sheet('Puzzle solved!', h('div', {},
      h('div', { class: 'big-result' }, `${n}×${n} · ${isBest ? 'new best time!' : 'time'}`, h('b', {}, fmtTime(st.elapsed))),
      h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
        h('div', {}, h('b', {}, String(slots.length)), h('span', {}, 'Clues')),
        h('div', {}, h('b', {}, String(revealed.size)), h('span', {}, 'Revealed')),
        h('div', {}, h('b', {}, best != null ? fmtTime(best) : '–'), h('span', {}, 'Best'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/'); } }, 'Home'),
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--cross)' }, onclick: () => { close(); pickCrossword((size) => ui.go(`#/crossword/new/${size}`, { replace: mode === 'practice' })); } }, 'New puzzle'))));
  }

  // ----- check / reveal -----
  function cellsFor(scope) {
    if (scope === 'letter') return [sel];
    if (scope === 'word') return slots[curSlot()].cells;
    return [...Array(N).keys()].filter((i) => !isBlock(i));
  }
  function doCheck(scope) {
    let bad = 0;
    for (const i of cellsFor(scope)) if (st.entries[i] && st.entries[i] !== answer(i)) { wrong.add(i); bad++; }
    toast(bad ? `${bad} square${bad > 1 ? 's' : ''} to fix` : 'All good so far!');
    save(); render();
  }
  function doReveal(scope) {
    for (const i of cellsFor(scope)) {
      if (st.entries[i] !== answer(i)) { st.entries[i] = answer(i); revealed.add(i); wrong.delete(i); }
    }
    save(); render(); checkDone();
  }
  function showMenu() {
    let close;
    const b = (label, fn) => h('button', { class: 'btn btn-soft', onclick: () => { close(); fn(); } }, label);
    if (st.status !== 'playing') {
      close = sheet('Puzzle', h('div', { class: 'menu-list' }, b('New puzzle', newPuzzle)));
      return;
    }
    close = sheet('Puzzle', h('div', {},
      h('div', { class: 'menu-cap' }, 'Check'),
      h('div', { class: 'menu-grid' }, b('Letter', () => doCheck('letter')), b('Word', () => doCheck('word')), b('Puzzle', () => doCheck('puzzle'))),
      h('div', { class: 'menu-cap' }, 'Reveal'),
      h('div', { class: 'menu-grid' }, b('Letter', () => doReveal('letter')), b('Word', () => doReveal('word')), b('Puzzle', () => doReveal('puzzle'))),
      h('div', { class: 'menu-cap' }, 'Other'),
      h('div', { class: 'menu-list' }, b('New puzzle…', newPuzzle), b('Clear all my letters', () => {
        for (let i = 0; i < N; i++) if (!revealed.has(i)) st.entries[i] = '';
        wrong.clear(); save(); render();
      }))));
  }
  function showClueSheet() {
    const list = (d) => slots.map((s, si) => [s, si]).filter(([s]) => s.dir === d).map(([s, si]) =>
      h('div', { class: 'cw-clue' + (si === curSlot() ? ' cur' : '') + (slotFull(si) ? ' done' : ''), onclick: () => { close(); jumpToSlot(si); } }, h('b', {}, String(s.num)), h('span', {}, s.clue)));
    const close = sheet('Clues', h('div', {}, h('div', { class: 'menu-cap' }, 'Across'), ...list('A'), h('div', { class: 'menu-cap' }, 'Down'), ...list('D')));
  }

  // ----- render -----
  function render() {
    const si = curSlot();
    const s = slots[si];
    const word = new Set(s.cells);
    const crossSi = cellSlot[dir === 'A' ? 'D' : 'A'][sel];
    for (let i = 0; i < N; i++) {
      if (isBlock(i)) continue;
      const c = cells[i];
      c.classList.toggle('sel', i === sel);
      c.classList.toggle('word', i !== sel && word.has(i));
      c.classList.toggle('revealed', revealed.has(i));
      c.classList.toggle('wrong', wrong.has(i));
      c.lastChild.textContent = st.entries[i] || '';
    }
    barText.replaceChildren(h('b', {}, `${s.num}${s.dir}`), s.clue);
    clueEls.forEach((el, j) => {
      el.classList.toggle('cur', j === si);
      el.classList.toggle('cross', j === crossSi);
      el.classList.toggle('done', slotFull(j));
    });
    // keep current clue visible in the list without moving the page
    const el = clueEls[si];
    const top = el.offsetTop;
    if (clueList.clientHeight > 40) {
      if (top < clueList.scrollTop + 28 || top + el.offsetHeight > clueList.scrollTop + clueList.clientHeight) {
        clueList.scrollTo({ top: Math.max(0, top - 30), behavior: 'smooth' });
      }
    }
  }

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.scrim')) return;
    if (e.key === 'Backspace') onKey('back');
    else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
    else if (e.key === 'Tab') { e.preventDefault(); moveSlot(e.shiftKey ? -1 : 1); }
    else if (e.key === ' ') { e.preventDefault(); toggleDir(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      const wantDir = dr ? 'D' : 'A';
      if (dir !== wantDir && cellSlot[wantDir][sel] >= 0) { dir = wantDir; render(); return; }
      let r = ((sel / n) | 0) + dr, c = (sel % n) + dc;
      while (r >= 0 && r < n && c >= 0 && c < n && isBlock(r * n + c)) { r += dr; c += dc; }
      if (r >= 0 && r < n && c >= 0 && c < n) tapCell(r * n + c);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  const onHide = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', onHide);

  fit();
  render();
  timerEl.textContent = fmtTime(st.elapsed);
  if (st.status === 'playing') timer.start();
  else {
    cells.forEach((c, i) => { if (!isBlock(i)) c.classList.add('ok'); });
    setTimeout(() => showWin(false), 300);
  }

  return () => {
    if (st.status === 'playing') save();
    timer.destroy();
    ro.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onHide);
  };
}
