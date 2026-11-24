# Puzzle Box

A personal puzzle app for Android (installable web app / PWA) with three games:

- **Word Guess** – guess the hidden 5-letter word in 6 tries. Daily word + unlimited mode, hard mode, stats and sharing.
- **Sudoku** – freshly generated puzzles with a guaranteed unique solution. Easy / Medium / Hard / Expert, notes, undo, hints, mistake flagging, daily puzzle.
- **Keystone** – an original idle tower-defense game drawn with simple shapes, balanced for long-term play: tiers with new enemy types, a multiplicative workshop, a research lab on real-time timers (1–3 slots), collectible relics from Warden bosses, six abilities with autocast and offline earnings. No ads. `tools/keystone-year-sim.mjs` simulates a year of play for balance tuning.
- **Crossword** – generated American-style grids of any size from 4×4 to 15×15 with clues. Daily puzzle (size set in Settings, default 5×5), check / reveal, timer.

Everything runs on the phone – no server, no account – and works offline after the first load.

## Install on Android

1. Open the GitHub Pages URL in **Chrome**.
2. Tap **⋮ → Add to Home screen → Install**.
3. Launch *Puzzle Box* from your home screen; it opens full screen like a normal app.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `css/styles.css` | App shell and styling (light + dark themes) |
| `js/app.js` | Router, home screen, settings |
| `js/wordle.js` | Word Guess game |
| `js/sudoku.js`, `js/sudoku-gen.js` | Sudoku UI and generator |
| `js/crossword.js`, `js/crossword-gen.js`, `js/crossword-worker.js` | Crossword UI, grid builder/filler, background worker |
| `js/keystone.js`, `js/keystone-engine.js` | Keystone screens (canvas) and headless game engine |
| `js/data/` | Generated word lists and clue database |
| `tools/build_data.py` | Rebuilds `js/data/` from WordNet + word frequencies |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install metadata |

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Rebuilding the word data

```
npm i wordnet-db          # WordNet 3.1 database files
pip install wordfreq
python3 tools/build_data.py node_modules/wordnet-db/dict js/data
```

Clues are derived from WordNet definitions (© Princeton University, WordNet license).
