// Sudoku generator with unique-solution guarantee and difficulty shaping.
import { mulberry32 } from './crossword-gen.js';

const ROW = [], COL = [], BOX = [], PEERS = [];
for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
}
for (let i = 0; i < 81; i++) {
  const s = new Set();
  for (let j = 0; j < 81; j++) if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) s.add(j);
  PEERS[i] = [...s];
}
const UNITS = [];
for (let k = 0; k < 9; k++) {
  UNITS.push([...Array(81).keys()].filter((i) => ROW[i] === k));
  UNITS.push([...Array(81).keys()].filter((i) => COL[i] === k));
  UNITS.push([...Array(81).keys()].filter((i) => BOX[i] === k));
}
export { ROW, COL, BOX, PEERS };

const bitCount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

function candMask(g, i) {
  let used = 0;
  for (const p of PEERS[i]) if (g[p]) used |= 1 << g[p];
  return ~used & 0x3fe;
}

// Count solutions up to `limit`.
export function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  let count = 0;
  function rec() {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candMask(g, i);
      const n = bitCount(m);
      if (n < bestN) { bestN = n; best = i; bestMask = m; if (n <= 1) break; }
    }
    if (best < 0) { count++; return count >= limit; }
    if (bestN === 0) return false;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      g[best] = d;
      if (rec()) { g[best] = 0; return true; }
    }
    g[best] = 0;
    return false;
  }
  rec();
  return count;
}

function fullGrid(rand) {
  const g = new Array(81).fill(0);
  function rec(i) {
    if (i === 81) return true;
    const m = candMask(g, i);
    const ds = [];
    for (let d = 1; d <= 9; d++) if (m & (1 << d)) ds.push(d);
    for (let k = ds.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [ds[k], ds[j]] = [ds[j], ds[k]]; }
    for (const d of ds) { g[i] = d; if (rec(i + 1)) return true; }
    g[i] = 0;
    return false;
  }
  rec(0);
  return g;
}

// Can the puzzle be solved with naked + hidden singles only?
function singlesSolvable(grid) {
  const g = grid.slice();
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candMask(g, i);
      if (bitCount(m) === 1) { g[i] = 31 - Math.clz32(m); progress = true; }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        let spot = -1, n = 0;
        for (const i of u) {
          if (g[i] === d) { n = -1; break; }
          if (!g[i] && candMask(g, i) & (1 << d)) { n++; spot = i; }
        }
        if (n === 1) { g[spot] = d; progress = true; }
      }
    }
  }
  return g.every((v) => v);
}

const TARGET = { easy: 38, medium: 31, hard: 27, expert: 24 };

export function generateSudoku(difficulty = 'medium', seed = Date.now()) {
  const rand = mulberry32(seed);
  const target = TARGET[difficulty] ?? 31;
  const needSingles = difficulty === 'easy' || difficulty === 'medium';
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const solution = fullGrid(rand);
    const puzzle = solution.slice();
    const order = [...Array(41).keys()];
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    let givens = 81;
    // two passes so later cells get another chance
    for (let pass = 0; pass < 2 && givens > target; pass++) {
      for (const i of order) {
        if (givens <= target) break;
        const j = 80 - i;
        if (!puzzle[i]) continue;
        const a = puzzle[i], b = puzzle[j];
        puzzle[i] = 0; puzzle[j] = 0;
        if (countSolutions(puzzle, 2) !== 1 || (needSingles && !singlesSolvable(puzzle))) {
          puzzle[i] = a; puzzle[j] = b;
        } else givens -= i === j ? 1 : 2;
      }
    }
    const res = { puzzle, solution, difficulty, givens };
    const hardEnough = needSingles || !singlesSolvable(puzzle);
    if (hardEnough && givens <= target + 2) return res;
    if (!best || givens < best.givens) best = res;
  }
  return best;
}
