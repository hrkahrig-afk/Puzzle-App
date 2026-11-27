import { WordIndex, generateCrossword, generateOpenCrossword } from './crossword-gen.js';

let indexes = null;
async function load() {
  if (indexes) return indexes;
  const res = await fetch(new URL('./data/clues.json', import.meta.url));
  const data = await res.json();
  indexes = [new WordIndex(data, 3.4), new WordIndex(data, 3.0), new WordIndex(data, 0)];
  return indexes;
}

self.onmessage = async (e) => {
  const { id, size, seed, style } = e.data;
  const gen = style === 'open' ? generateOpenCrossword : generateCrossword;
  try {
    const idx = await load();
    let puzzle = gen(size, seed, idx);
    // extremely unlikely: try a few other seeds before giving up
    for (let k = 1; !puzzle && k < 5; k++) puzzle = gen(size, seed + k * 7919, idx);
    self.postMessage({ id, puzzle });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
