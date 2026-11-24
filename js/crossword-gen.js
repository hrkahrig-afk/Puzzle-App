// Crossword generator: builds a symmetric American-style grid and fills it
// from a word/clue list using bitset-backed backtracking search.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const A = 97;

// ---------- Word index ----------
export class WordIndex {
  constructor(entries, minZipf = 0) {
    // entries: [word, clue, zipf]
    this.byLen = new Map();
    for (const [w, clue, z] of entries) {
      if (z < minZipf || w.length > 15 || w.length < 3) continue;
      let b = this.byLen.get(w.length);
      if (!b) this.byLen.set(w.length, (b = { words: [], clues: [], z: [] }));
      b.words.push(w);
      b.clues.push(clue);
      b.z.push(z);
    }
    for (const [len, b] of this.byLen) {
      const n = b.words.length;
      const W = (n + 31) >>> 5;
      b.W = W;
      // pos[i*26 + letter] -> bitset
      b.pos = new Array(len * 26);
      for (let i = 0; i < len * 26; i++) b.pos[i] = new Uint32Array(W);
      for (let j = 0; j < n; j++) {
        const w = b.words[j];
        for (let i = 0; i < len; i++) {
          b.pos[i * 26 + (w.charCodeAt(i) - A)][j >>> 5] |= 1 << (j & 31);
        }
      }
      b.all = new Uint32Array(W);
      for (let j = 0; j < n; j++) b.all[j >>> 5] |= 1 << (j & 31);
    }
  }
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// ---------- Grid pattern ----------
const TARGET_BLACK = { 3: 0, 4: 0, 5: 2, 6: 4, 7: 6, 8: 10, 9: 12, 10: 16, 11: 20, 12: 24, 13: 30, 14: 34, 15: 38 };

function maxRunFor(n) {
  if (n === 6) return 5;
  if (n <= 7) return n;
  if (n <= 9) return 8;
  if (n <= 11) return 9;
  return 10;
}

function validPattern(g, n) {
  // every white run (row and column) must be >= 3 long
  for (let r = 0; r < n; r++) {
    let run = 0;
    for (let c = 0; c <= n; c++) {
      if (c < n && !g[r * n + c]) run++;
      else { if (run > 0 && run < 3) return false; run = 0; }
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 0;
    for (let r = 0; r <= n; r++) {
      if (r < n && !g[r * n + c]) run++;
      else { if (run > 0 && run < 3) return false; run = 0; }
    }
  }
  // connectivity of white cells
  let start = -1, whites = 0;
  for (let i = 0; i < n * n; i++) if (!g[i]) { whites++; if (start < 0) start = i; }
  if (start < 0) return false;
  const seen = new Uint8Array(n * n);
  const stack = [start];
  seen[start] = 1;
  let cnt = 0;
  while (stack.length) {
    const i = stack.pop();
    cnt++;
    const r = (i / n) | 0, c = i % n;
    const nb = [];
    if (r > 0) nb.push(i - n);
    if (r < n - 1) nb.push(i + n);
    if (c > 0) nb.push(i - 1);
    if (c < n - 1) nb.push(i + 1);
    for (const j of nb) if (!g[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
  }
  return cnt === whites;
}

function maxRun(g, n) {
  let m = 0;
  for (let r = 0; r < n; r++) {
    let run = 0;
    for (let c = 0; c < n; c++) { run = g[r * n + c] ? 0 : run + 1; m = Math.max(m, run); }
  }
  for (let c = 0; c < n; c++) {
    let run = 0;
    for (let r = 0; r < n; r++) { run = g[r * n + c] ? 0 : run + 1; m = Math.max(m, run); }
  }
  return m;
}

function cellsInLongRuns(g, n, limit) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let start = 0;
    for (let c = 0; c <= n; c++) {
      if (c === n || g[r * n + c]) {
        if (c - start > limit) for (let k = start; k < c; k++) out.push(r * n + k);
        start = c + 1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let start = 0;
    for (let r = 0; r <= n; r++) {
      if (r === n || g[r * n + c]) {
        if (r - start > limit) for (let k = start; k < r; k++) out.push(k * n + c);
        start = r + 1;
      }
    }
  }
  return out;
}

function touchesEdgeOrBlock(g, n, i) {
  const r = (i / n) | 0, c = i % n;
  if (r === 0 || c === 0 || r === n - 1 || c === n - 1) return true;
  return g[i - 1] || g[i + 1] || g[i - n] || g[i + n];
}

export function makePattern(n, rand, relax = 0) {
  const target = (TARGET_BLACK[n] ?? Math.round(n * n * 0.2)) + relax * 2;
  const limit = Math.max(5, maxRunFor(n) - (relax >> 1));
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Uint8Array(n * n);
    let blacks = 0;
    // small grids: sometimes keep them fully open / only corner blocks
    if (n <= 5 && rand() < 0.25) {
      if (rand() < 0.5) return g;
    }
    let tries = 0;
    while (tries < 900) {
      const over = blacks >= target;
      const longCells = over ? cellsInLongRuns(g, n, limit) : null;
      if (over && !longCells.length) break;
      tries++;
      const i = over ? longCells[Math.floor(rand() * longCells.length)] : Math.floor(rand() * n * n);
      if (g[i]) continue;
      // favour blocks that touch an edge or another block (looks like a real grid)
      if (!over && !touchesEdgeOrBlock(g, n, i) && rand() < 0.7) continue;
      const j = n * n - 1 - i;
      g[i] = 1; g[j] = 1;
      if (!validPattern(g, n)) { g[i] = 0; g[j] = 0; continue; }
      blacks += i === j ? 1 : 2;
    }
    if (blacks >= target && maxRun(g, n) <= limit && validPattern(g, n)) return g;
  }
  return null;
}

// ---------- Slots ----------
function buildSlots(g, n) {
  const slots = [];
  const cellSlots = Array.from({ length: n * n }, () => []);
  const numbers = new Int16Array(n * n);
  let num = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (g[i]) continue;
      const startA = (c === 0 || g[i - 1]) && c + 1 < n && !g[i + 1];
      const startD = (r === 0 || g[i - n]) && r + 1 < n && !g[i + n];
      if (startA || startD) numbers[i] = ++num;
      if (startA) {
        const cells = [];
        for (let k = c; k < n && !g[r * n + k]; k++) cells.push(r * n + k);
        slots.push({ dir: 'across', num, row: r, col: c, cells });
      }
      if (startD) {
        const cells = [];
        for (let k = r; k < n && !g[k * n + c]; k++) cells.push(k * n + c);
        slots.push({ dir: 'down', num, row: r, col: c, cells });
      }
    }
  }
  slots.forEach((s, si) => s.cells.forEach((cell, pos) => cellSlots[cell].push([si, pos])));
  return { slots, cellSlots, numbers };
}

// ---------- Fill ----------
function fill(g, n, index, rand, nodeLimit) {
  const { slots, cellSlots, numbers } = buildSlots(g, n);
  for (const s of slots) if (!index.byLen.get(s.cells.length)) return null;
  const letters = new Int8Array(n * n).fill(-1);
  const assigned = new Int32Array(slots.length).fill(-1);
  const used = new Set();
  let nodes = 0;
  const scratch = new Map();

  function candidates(si) {
    const s = slots[si];
    const b = index.byLen.get(s.cells.length);
    let bs = null;
    for (let p = 0; p < s.cells.length; p++) {
      const L = letters[s.cells[p]];
      if (L < 0) continue;
      const pb = b.pos[p * 26 + L];
      if (!bs) {
        bs = scratch.get(si);
        if (!bs || bs.length !== b.W) { bs = new Uint32Array(b.W); scratch.set(si, bs); }
        bs.set(pb);
      } else for (let k = 0; k < b.W; k++) bs[k] &= pb[k];
    }
    return bs || b.all;
  }
  function count(bs) {
    let c = 0;
    for (let k = 0; k < bs.length; k++) if (bs[k]) c += popcount(bs[k]);
    return c;
  }

  function pickSlot() {
    let best = -1, bestCount = Infinity;
    for (let si = 0; si < slots.length; si++) {
      if (assigned[si] >= 0) continue;
      const c = count(candidates(si));
      if (c < bestCount) { bestCount = c; best = si; if (c === 0) break; }
    }
    return [best, bestCount];
  }

  function listCands(si) {
    const bs = candidates(si);
    const b = index.byLen.get(slots[si].cells.length);
    const out = [];
    for (let k = 0; k < bs.length; k++) {
      let x = bs[k];
      while (x) {
        const t = x & -x;
        const j = (k << 5) + (31 - Math.clz32(t));
        x ^= t;
        if (!used.has(b.words[j])) out.push(j);
      }
    }
    // weight by frequency with randomness, keep a beam
    const scored = out.map((j) => [j, b.z[j] + rand() * 2.5]);
    scored.sort((x, y) => y[1] - x[1]);
    return scored.slice(0, 24).map((x) => x[0]);
  }

  function place(si, j) {
    const s = slots[si];
    const w = index.byLen.get(s.cells.length).words[j];
    const changed = [];
    for (let p = 0; p < s.cells.length; p++) {
      const cell = s.cells[p];
      if (letters[cell] < 0) { letters[cell] = w.charCodeAt(p) - A; changed.push(cell); }
    }
    assigned[si] = j;
    used.add(w);
    return changed;
  }
  function unplace(si, changed) {
    const s = slots[si];
    used.delete(index.byLen.get(s.cells.length).words[assigned[si]]);
    assigned[si] = -1;
    for (const c of changed) letters[c] = -1;
  }

  function crossOk(changed) {
    for (const cell of changed) {
      for (const [sj] of cellSlots[cell]) {
        if (assigned[sj] >= 0) continue;
        if (count(candidates(sj)) === 0) return false;
      }
    }
    return true;
  }

  // Also mark slots completed implicitly by crossings
  function autoAssign() {
    const made = [];
    for (let si = 0; si < slots.length; si++) {
      if (assigned[si] >= 0) continue;
      const s = slots[si];
      if (s.cells.every((c) => letters[c] >= 0)) {
        const w = s.cells.map((c) => String.fromCharCode(letters[c] + A)).join('');
        const b = index.byLen.get(w.length);
        const j = b.words.indexOf(w);
        if (j < 0 || used.has(w)) { made.forEach((m) => { used.delete(index.byLen.get(slots[m].cells.length).words[assigned[m]]); assigned[m] = -1; }); return null; }
        assigned[si] = j; used.add(w); made.push(si);
      }
    }
    return made;
  }
  function undoAuto(made) {
    for (const m of made) { used.delete(index.byLen.get(slots[m].cells.length).words[assigned[m]]); assigned[m] = -1; }
  }

  function solve() {
    if (++nodes > nodeLimit) return false;
    const [si, c] = pickSlot();
    if (si < 0) return true;
    if (c === 0) return false;
    for (const j of listCands(si)) {
      const changed = place(si, j);
      if (crossOk(changed)) {
        const made = autoAssign();
        if (made) {
          if (solve()) return true;
          undoAuto(made);
        }
      }
      unplace(si, changed);
      if (nodes > nodeLimit) return false;
    }
    return false;
  }

  if (!solve()) return null;

  const grid = [];
  for (let r = 0; r < n; r++) {
    let row = '';
    for (let c = 0; c < n; c++) row += g[r * n + c] ? '#' : String.fromCharCode(letters[r * n + c] + A).toUpperCase();
    grid.push(row);
  }
  const across = [], down = [];
  slots.forEach((s, si) => {
    const b = index.byLen.get(s.cells.length);
    const entry = { num: s.num, row: s.row, col: s.col, len: s.cells.length, answer: b.words[assigned[si]].toUpperCase(), clue: b.clues[assigned[si]] };
    (s.dir === 'across' ? across : down).push(entry);
  });
  return { size: n, grid, numbers: Array.from(numbers), across, down };
}

// Generate a puzzle. Deterministic for a given seed.
export function generateCrossword(size, seed, indexes) {
  const rand = mulberry32(seed);
  const n = Math.max(3, Math.min(15, size | 0));
  // indexes: array of WordIndex from strict (common words) to lenient
  for (let round = 0; round < 60; round++) {
    const idx = indexes[Math.min(indexes.length - 1, Math.floor(round / 6))];
    const relax = n >= 6 ? Math.min(6, round >> 1) : 0;
    const g = makePattern(n, rand, relax);
    if (!g) continue;
    const limit = n <= 5 ? 3000 : n <= 9 ? 6000 : 4000;
    const res = fill(g, n, idx, rand, limit);
    if (res) { res.seed = seed; return res; }
  }
  return null;
}
