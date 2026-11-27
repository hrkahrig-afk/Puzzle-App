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

// ---------- Open (criss-cross) style ----------
// Words cross each other at single squares; every other square belongs to just
// one word, and words never touch side by side. Empty squares are open space.
function buildOpen(n, idx, rand) {
  const N = n * n;
  const L = new Int8Array(N).fill(-1); // letter at each cell (0..25), -1 empty
  const hasA = new Uint8Array(N), hasD = new Uint8Array(N);
  const words = []; // {dir,row,col,len,j}
  const used = new Set();
  const at = (r, c) => (r < 0 || c < 0 || r >= n || c >= n ? -1 : L[r * n + c]);

  function pickWord(b, mask) {
    const ids = [];
    for (let w = 0; w < b.W; w++) {
      let x = mask[w];
      while (x) { const t = x & -x; ids.push((w << 5) + 31 - Math.clz32(t)); x ^= t; }
    }
    const ok = ids.filter((j) => !used.has(b.words[j]));
    if (!ok.length) return -1;
    // favour common words, with some variety
    ok.sort((a, c) => b.z[c] - b.z[a]);
    const top = Math.max(1, Math.ceil(ok.length * 0.25));
    return ok[Math.floor(rand() * Math.min(top, 40))];
  }

  // try to fit a word of length len starting at (r,c) in direction d
  function evaluate(d, r, c, len) {
    const dr = d === 'D' ? 1 : 0, dc = d === 'A' ? 1 : 0;
    const er = r + dr * (len - 1), ec = c + dc * (len - 1);
    if (r < 0 || c < 0 || er >= n || ec >= n) return null;
    if (at(r - dr, c - dc) >= 0 || at(er + dr, ec + dc) >= 0) return null;
    const b = idx.byLen.get(len);
    if (!b) return null;
    const mask = b.all.slice();
    let cross = 0;
    for (let k = 0; k < len; k++) {
      const rr = r + dr * k, cc = c + dc * k, i = rr * n + cc;
      if (L[i] >= 0) {
        if (d === 'A' ? hasA[i] : hasD[i]) return null;
        // two crossings in a row would mean parallel words touching
        if (k > 0 && L[i - (dr * n + dc)] >= 0) return null;
        cross++;
        const p = b.pos[k * 26 + L[i]];
        let any = 0;
        for (let w = 0; w < b.W; w++) any |= (mask[w] &= p[w]);
        if (!any) return null;
      } else if (at(rr + dc, cc + dr) >= 0 || at(rr - dc, cc - dr) >= 0) return null; // side neighbours must be open
    }
    if (!cross && words.length) return null;
    return { mask, cross, b };
  }

  function place(d, r, c, len, j) {
    const b = idx.byLen.get(len);
    const w = b.words[j];
    used.add(w);
    words.push({ dir: d, row: r, col: c, len, j });
    for (let k = 0; k < len; k++) {
      const i = (r + (d === 'D' ? k : 0)) * n + c + (d === 'A' ? k : 0);
      L[i] = w.charCodeAt(k) - A;
      (d === 'A' ? hasA : hasD)[i] = 1;
    }
  }

  // first word: a long across word through the middle
  const len0 = Math.max(3, n - Math.floor(rand() * Math.min(3, n - 2)));
  const r0 = Math.floor(n / 2) + (n > 6 ? Math.floor(rand() * 3) - 1 : 0);
  const c0 = Math.floor(rand() * (n - len0 + 1));
  const first = evaluate('A', r0, c0, len0);
  if (!first) return null;
  const j0 = pickWord(first.b, first.mask);
  if (j0 < 0) return null;
  place('A', r0, c0, len0, j0);

  const maxWords = Math.round(n * n / 5) + 2;
  for (let step = 0; step < maxWords; step++) {
    // candidate anchors: letters with only one word through them
    const anchors = [];
    for (let i = 0; i < N; i++) if (L[i] >= 0 && hasA[i] + hasD[i] === 1) anchors.push(i);
    for (let k = anchors.length - 1; k > 0; k--) { const m = Math.floor(rand() * (k + 1)); [anchors[k], anchors[m]] = [anchors[m], anchors[k]]; }
    let best = null;
    for (const i of anchors.slice(0, 40)) {
      const d = hasA[i] ? 'D' : 'A';
      const r = (i / n) | 0, c = i % n;
      const pos = d === 'D' ? r : c;
      for (let len = 3; len <= n; len++) {
        for (let off = Math.max(0, pos - (n - len)); off <= Math.min(len - 1, pos); off++) {
          const sr = d === 'D' ? r - off : r, sc = d === 'A' ? c - off : c;
          const ev = evaluate(d, sr, sc, len);
          if (!ev) continue;
          const cnt = ev.mask.reduce((a, x) => a + popcount(x), 0);
          if (!cnt) continue;
          // more crossings and longer words make a tighter, more interesting grid
          const score = ev.cross * 5 + len * 0.9 + Math.min(3, Math.log2(cnt) * 0.4) + rand() * 3;
          if (!best || score > best.score) best = { score, d, sr, sc, len, ev };
        }
      }
    }
    if (!best) break;
    const j = pickWord(best.ev.b, best.ev.mask);
    if (j < 0) break;
    place(best.d, best.sr, best.sc, best.len, j);
  }

  // shift the layout so it sits in the middle of the square
  let minR = n, maxR = -1, minC = n, maxC = -1;
  for (let i = 0; i < N; i++) if (L[i] >= 0) { const r = (i / n) | 0, c = i % n; minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  const sr = Math.floor((n - 1 - maxR - minR) / 2), sc = Math.floor((n - 1 - maxC - minC) / 2);
  const filled = L.reduce((a, x) => a + (x >= 0), 0);
  return { words: words.map((w) => ({ ...w, row: w.row + sr, col: w.col + sc })), filled, span: (maxR - minR + 1) * (maxC - minC + 1) };
}

export function generateOpenCrossword(size, seed, indexes) {
  const rand = mulberry32(seed ^ 0x5bd1e995);
  const n = Math.max(4, Math.min(15, size | 0));
  let best = null, bestIdx = null;
  const tries = n <= 7 ? 14 : 8;
  for (let t = 0; t < tries; t++) {
    const idx = indexes[t < tries - 2 ? 0 : 1];
    const res = buildOpen(n, idx, rand);
    if (!res || res.words.length < 2) continue;
    // reward letters used and how much of the square the puzzle spans
    const score = res.filled + res.span * 0.15 + res.words.length;
    if (!best || score > best.score) { best = { ...res, score }; bestIdx = idx; }
  }
  if (!best) return null;
  const N = n * n;
  const letters = Array(N).fill('#');
  for (const w of best.words) {
    const word = bestIdx.byLen.get(w.len).words[w.j].toUpperCase();
    for (let k = 0; k < w.len; k++) letters[(w.row + (w.dir === 'D' ? k : 0)) * n + w.col + (w.dir === 'A' ? k : 0)] = word[k];
  }
  const numbers = new Array(N).fill(0);
  const starts = new Map();
  for (const w of best.words) starts.set(w.row * n + w.col, true);
  let num = 0;
  for (let i = 0; i < N; i++) if (starts.has(i)) numbers[i] = ++num;
  const across = [], down = [];
  for (const w of best.words) {
    const b = bestIdx.byLen.get(w.len);
    const entry = { num: numbers[w.row * n + w.col], row: w.row, col: w.col, len: w.len, answer: b.words[w.j].toUpperCase(), clue: b.clues[w.j] };
    (w.dir === 'A' ? across : down).push(entry);
  }
  across.sort((a, b) => a.num - b.num); down.sort((a, b) => a.num - b.num);
  const grid = [];
  for (let r = 0; r < n; r++) grid.push(letters.slice(r * n, r * n + n).join(''));
  return { size: n, style: 'open', grid, numbers, across, down, seed };
}
