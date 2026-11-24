import { generateSudoku, ROW, COL, BOX, PEERS } from './sudoku-gen.js';
import {
  h, icon, iconBtn, store, getSettings, todayKey, hashStr, fmtTime, toast, sheet, haptic, makeTimer,
  recordDaily, recordBest, getBest,
} from './core.js';
import { pickSudoku } from './app.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function mount(view, params, ui) {
  const settings = getSettings();
  const today = todayKey();
  let mode = params[0] === 'daily' ? 'daily' : 'practice';
  let st;

  if (mode === 'daily') {
    const diff = settings.sudokuDaily;
    st = store.get('sudoku:daily');
    if (!st || st.date !== today || st.difficulty !== diff) {
      st = fresh(generateSudoku(diff, hashStr(`sudoku:${today}:${diff}`)));
      st.date = today;
    }
  } else if (params[0] === 'new') {
    const diff = ['easy', 'medium', 'hard', 'expert'].includes(params[1]) ? params[1] : settings.sudokuNew;
    st = fresh(generateSudoku(diff, (Math.random() * 2 ** 32) >>> 0));
    store.set('sudoku:practice', st);
    history.replaceState(null, '', '#/sudoku/practice');
  } else {
    st = store.get('sudoku:practice');
    if (!st) { st = fresh(generateSudoku(settings.sudokuNew, (Math.random() * 2 ** 32) >>> 0)); }
  }
  const key = mode === 'daily' ? 'sudoku:daily' : 'sudoku:practice';

  function fresh(g) {
    return { difficulty: g.difficulty, puzzle: g.puzzle, solution: g.solution, values: g.puzzle.slice(), notes: Array(81).fill(0), mistakes: 0, hints: 0, elapsed: 0, status: 'playing' };
  }

  let sel = st.values.findIndex((v) => !v);
  if (sel < 0) sel = 40;
  let notesMode = false;
  const undoStack = [];
  const check = settings.sudokuCheck;

  // ----- header -----
  const timerEl = h('span', { class: 'timer' });
  if (!settings.showTimer) timerEl.style.visibility = 'hidden';
  ui.setTitle(h('span', {}, 'Sudoku', h('span', { class: 'mode-pill' }, `${mode === 'daily' ? 'Daily · ' : ''}${cap(st.difficulty)}`)));
  ui.setActions([
    timerEl,
    mode === 'practice' ? iconBtn('plus', 'New puzzle', () => pickSudoku((d) => ui.go(`#/sudoku/new/${d}`, { replace: true }))) : null,
  ]);
  const timer = makeTimer(st.elapsed, (t) => { timerEl.textContent = fmtTime(t); });
  const save = () => { st.elapsed = timer.get(); store.set(key, st); };

  // ----- board -----
  const board = h('div', { class: 's-board' });
  const cells = [];
  for (let i = 0; i < 81; i++) {
    const c = h('div', { class: 's-cell' + (COL[i] === 2 || COL[i] === 5 ? ' br' : '') + (ROW[i] === 2 || ROW[i] === 5 ? ' bb' : '') + (ROW[i] === 8 ? ' lastrow' : '') });
    c.addEventListener('pointerdown', (e) => { e.preventDefault(); sel = i; render(); });
    cells.push(c);
    board.append(c);
  }
  const info = h('div', { class: 's-info' });

  const mkTool = (name, label, fn) => {
    const b = h('button', { class: 'tool', onclick: fn }, icon(name), label);
    return b;
  };
  const notesBadge = h('span', { class: 'badge' }, 'OFF');
  const tUndo = mkTool('undo', 'Undo', undo);
  const tErase = mkTool('erase', 'Erase', erase);
  const tNotes = mkTool('pencil', 'Notes', () => { notesMode = !notesMode; render(); });
  tNotes.append(notesBadge);
  const tHint = mkTool('bulb', 'Hint', hint);
  const tools = h('div', { class: 's-tools' }, tUndo, tErase, tNotes, tHint);

  const nums = [];
  const pad = h('div', { class: 's-pad' });
  for (let d = 1; d <= 9; d++) {
    const small = h('small');
    const b = h('button', { class: 's-num' }, String(d), small);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); input(d); });
    nums.push({ b, small });
    pad.append(b);
  }
  const root = h('div', { class: 'sudoku' }, info, h('div', { class: 's-board-wrap' }, board), tools, pad);
  view.append(root);

  // ----- logic -----
  function snapshot() {
    undoStack.push({ values: st.values.slice(), notes: st.notes.slice() });
    if (undoStack.length > 200) undoStack.shift();
  }
  function input(d) {
    if (st.status !== 'playing' || sel < 0) return;
    haptic(8);
    if (st.puzzle[sel]) return;
    if (notesMode) {
      if (st.values[sel]) return;
      snapshot();
      st.notes[sel] ^= 1 << d;
    } else {
      if (st.values[sel] === d) return;
      snapshot();
      st.values[sel] = d;
      st.notes[sel] = 0;
      cells[sel].classList.remove('pop'); void cells[sel].offsetWidth; cells[sel].classList.add('pop');
      if (d !== st.solution[sel]) {
        if (check) { st.mistakes++; haptic(60); }
      } else {
        for (const p of PEERS[sel]) st.notes[p] &= ~(1 << d);
        flashUnits(sel);
      }
    }
    save();
    render();
    checkDone();
  }
  function flashUnits(i) {
    const groups = [
      [...Array(81).keys()].filter((j) => ROW[j] === ROW[i]),
      [...Array(81).keys()].filter((j) => COL[j] === COL[i]),
      [...Array(81).keys()].filter((j) => BOX[j] === BOX[i]),
    ];
    for (const g of groups) {
      if (g.every((j) => st.values[j] === st.solution[j])) {
        g.forEach((j, k) => setTimeout(() => { cells[j].classList.remove('flash'); void cells[j].offsetWidth; cells[j].classList.add('flash'); }, k * 30));
      }
    }
  }
  function erase() {
    if (st.status !== 'playing' || sel < 0 || st.puzzle[sel]) return;
    if (!st.values[sel] && !st.notes[sel]) return;
    snapshot();
    st.values[sel] = 0; st.notes[sel] = 0;
    save(); render();
  }
  function undo() {
    if (st.status !== 'playing') return;
    const s = undoStack.pop();
    if (!s) return toast('Nothing to undo');
    st.values = s.values; st.notes = s.notes;
    save(); render();
  }
  function hint() {
    if (st.status !== 'playing') return;
    let i = sel >= 0 && !st.puzzle[sel] && st.values[sel] !== st.solution[sel] ? sel : -1;
    if (i < 0) i = st.values.findIndex((v, j) => v !== st.solution[j]);
    if (i < 0) return;
    snapshot();
    st.values[i] = st.solution[i];
    st.notes[i] = 0;
    for (const p of PEERS[i]) st.notes[p] &= ~(1 << st.solution[i]);
    st.hints++;
    sel = i;
    save(); render();
    cells[i].classList.remove('flash'); void cells[i].offsetWidth; cells[i].classList.add('flash');
    checkDone();
  }
  function checkDone() {
    if (st.values.some((v) => !v)) return;
    if (st.values.every((v, i) => v === st.solution[i])) win();
    else toast('Almost! Something isn’t right yet', 2200);
  }
  function win() {
    st.status = 'won';
    timer.stop();
    save();
    render();
    const secs = st.elapsed;
    const isBest = st.hints === 0 && recordBest(`sudoku:${st.difficulty}`, secs);
    if (mode === 'daily') recordDaily('sudoku', st.date, true);
    haptic(40);
    setTimeout(() => showWin(isBest), 700);
  }
  function showWin(isBest) {
    const best = getBest(`sudoku:${st.difficulty}`);
    const close = sheet('Solved!', h('div', {},
      h('div', { class: 'big-result' }, `${cap(st.difficulty)} · ${isBest ? 'new best time!' : 'time'}`, h('b', {}, fmtTime(st.elapsed))),
      h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
        h('div', {}, h('b', {}, String(st.mistakes)), h('span', {}, 'Mistakes')),
        h('div', {}, h('b', {}, String(st.hints)), h('span', {}, 'Hints')),
        h('div', {}, h('b', {}, best != null ? fmtTime(best) : '–'), h('span', {}, 'Best'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/'); } }, 'Home'),
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--sudoku)' }, onclick: () => { close(); pickSudoku((d) => ui.go(`#/sudoku/new/${d}`, { replace: mode === 'practice' })); } }, 'New puzzle'))));
  }

  function render() {
    const selVal = sel >= 0 ? st.values[sel] : 0;
    const counts = Array(10).fill(0);
    for (let i = 0; i < 81; i++) if (st.values[i] && (!check || st.values[i] === st.solution[i])) counts[st.values[i]]++;
    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      const v = st.values[i];
      const peer = sel >= 0 && (ROW[i] === ROW[sel] || COL[i] === COL[sel] || BOX[i] === BOX[sel]);
      let wrong = false;
      if (v && !st.puzzle[i]) {
        if (check) wrong = v !== st.solution[i];
        else wrong = PEERS[i].some((p) => st.values[p] === v);
      }
      c.className = c.className.replace(/\s(given|peer|same|sel|wrong)\b/g, '');
      if (st.puzzle[i]) c.classList.add('given');
      if (i === sel) c.classList.add('sel');
      else if (selVal && v === selVal) c.classList.add('same');
      else if (peer) c.classList.add('peer');
      if (wrong) c.classList.add('wrong');
      if (v) {
        if (c.dataset.v !== String(v)) { c.replaceChildren(String(v)); c.dataset.v = String(v); }
      } else {
        const n = st.notes[i];
        const key2 = 'n' + n + ':' + selVal;
        if (c.dataset.v !== key2) {
          c.dataset.v = key2;
          if (!n) c.replaceChildren();
          else {
            const g = h('div', { class: 's-notes' });
            for (let d = 1; d <= 9; d++) g.append(h('span', { class: n & (1 << d) && d === selVal ? 'hl' : null }, n & (1 << d) ? String(d) : ''));
            c.replaceChildren(g);
          }
        }
      }
    }
    nums.forEach(({ b, small }, k) => {
      const d = k + 1;
      const left = 9 - counts[d];
      b.classList.toggle('gone', left <= 0);
      small.textContent = left > 0 ? String(left) : '';
    });
    tNotes.classList.toggle('on', notesMode);
    notesBadge.textContent = notesMode ? 'ON' : 'OFF';
    root.classList.toggle('notes-mode', notesMode);
    info.replaceChildren(h('span', {}, check ? `Mistakes: ${st.mistakes}` : `Hints used: ${st.hints}`), h('span', {}, st.status === 'won' ? 'Solved ✓' : `${st.values.filter((v) => !v).length} cells left`));
  }

  const onKeyDown = (e) => {
    if (document.querySelector('.scrim')) return;
    if (/^[1-9]$/.test(e.key)) input(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'n') { notesMode = !notesMode; render(); }
    else if (e.key.startsWith('Arrow')) {
      const r = ROW[sel], c = COL[sel];
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      sel = ((r + d[0] + 9) % 9) * 9 + ((c + d[1] + 9) % 9);
      render();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  const onHide = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', onHide);

  render();
  timerEl.textContent = fmtTime(st.elapsed);
  if (st.status === 'playing') timer.start();
  else setTimeout(() => showWin(false), 300);

  return () => {
    if (st.status === 'playing') save();
    timer.destroy();
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onHide);
  };
}
