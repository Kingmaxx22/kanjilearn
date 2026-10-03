# Kanji Study

An offline-first kanji study app: hiragana, katakana and JLPT N5–N1 kanji, with
stroke order, on/kun readings, furigana, real example words, and a draw-to-search
pad that recognises a character you sketch.

It is a static site — no framework, no bundler, no npm dependencies. Plain ES
modules, plain CSS, one service worker. The same files also compile into a native
Windows desktop app (see [DESKTOP.md](DESKTOP.md)).

| | |
| --- | --- |
| Kanji | 2381, across N5–N1 |
| Kana | 163 (hiragana + katakana) with stroke order |
| Words | JLPT vocabulary with readings, furigana and example sentences |
| Draw index | 2539 recognisable characters |
| Data bundles | 6.2 MB across 8 files, generated |

## Features

- **Kana** — chart and per-character detail: stroke order animation, readings,
  words that use the character.
- **Kanji** — grid per level, and a detail page with stroke order, grade, stroke
  count, radical, frequency, on/kun and nanori readings, every meaning, and the
  words it actually appears in, each with per-kanji **furigana** and a gloss.
- **Draw** — sketch a character on the pad and it is matched against all 2539
  templates in a Web Worker; candidates are ranked by confidence and link
  straight to the character. An optional ghost shows the target outline, and
  diagonals appear when one is loaded.
- **Study** — drills built from the kanji you are looking at, in three modes:
  meaning, reading and recall. Progress is kept in `localStorage`.
- **Themes** — light and dark, following the system preference by default.
- **Offline** — a service worker precaches the shell; data bundles are cached on
  first use. Installable as a PWA.

## Quick start

The app needs its generated data bundles before it can render anything. From a
fresh clone:

```bash
# 1. put the datasets in place (see "Datasets" below)
# 2. generate data/
node tools/build-data.mjs

# 3. serve it — ES modules and workers do not work over file://
python -m http.server 8137
```

Then open <http://localhost:8137/>.

Any static server works; there is no backend. `npm` is not used anywhere.

## Datasets

`tools/build-data.mjs` reads from `cache/` and writes `data/`. It does **not**
download anything, so a fresh clone has an empty `cache/` and nothing will build
until you populate it. `cache/` is gitignored: the files are large and
reproducible.

Create the directory and place the files as follows.

| Path in `cache/` | Source |
| --- | --- |
| `kanjidic2.xml.gz` | [EDRDG KANJIDIC2](https://www.edrdg.org/kanjidic/kanjidic2.xml.gz) |
| `kanjivg.xml.gz` | KanjiVG release asset `kanjivg-<date>.xml.gz`, e.g. [r20260714](https://github.com/KanjiVG/kanjivg/releases/tag/r20260714) |
| `jmdict-eng-common-3.6.2.json` | `JMdict-eng-common-*.json` from a [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) release (the EDRDG ftp archive is retired) |
| `openjlpt/kanji/n{5,4,3,2,1}.json` | [evanclan/OpenJLPT](https://github.com/evanclan/OpenJLPT) → `data/json/kanji/` |
| `openjlpt/vocab/n{5,4,3,2,1}.json` | same repo → `data/json/vocab/` |
| `strokesvg-main/dist/` | [zhengkyl/strokesvg](https://github.com/zhengkyl/strokesvg) → `dist/hiragana`, `dist/katakana` (kana outlines, derived from the Klee One font) |

Keep the exact filenames above; the build script looks for them by name. Only the
`dist/` subdirectory of strokesvg is needed.

Then:

```bash
node tools/build-data.mjs   # ~6s, writes 8 files totalling 6.2 MB
node tools/verify.mjs      # consistency checks on the generated bundles
```

`verify.mjs` checks that every level bundle resolves, that stroke counts and
drawings line up, and that the readings mined from furigana agree with KANJIDIC2
on a held-out sample. All checks should pass.

## Testing

```bash
./tools/smoke.sh            # loads all 12 routes in headless Chrome, fails on any console error
./tools/smoke.sh 3000       # against a server you are already running
```

For the packaged desktop app:

```bash
./tools/launch-debug.sh         # run the exe with WebView2 remote debugging
node tools/verify-desktop.mjs   # every view, the worker, and a no-network proof
```

## Desktop app

`./tools/build-desktop.sh` produces a self-contained `kanjilearn.exe` (~5.2 MB)
and an NSIS installer (~3.3 MB) with everything embedded. Full details, including
why it is a webview shell rather than a folder of HTML, are in
[DESKTOP.md](DESKTOP.md).

```bash
cargo install tauri-cli --version "^2" --locked   # only needed for the installer
./tools/build-desktop.sh
```

Requires Rust (MSVC target), Visual Studio 2022 build tools, WebView2, Node and
Python.

## Layout

```
index.html          shell: topbar, nav, #view
app.js              theme, hash router, service worker registration
styles.css          all styling; light and dark themes
sw.js               offline shell precache + cache-first data
js/
  store.js          data loading and progress persistence
  recognizer.js     stroke template index and matching
  recognizer.worker.js  builds the index off the main thread
  strokes.js        stroke path parsing and glyph rendering
  furigana.js       ruby annotation
  util.js           DOM and localStorage helpers
  views/            kanji.js, kana.js, draw.js, study.js
tools/
  build-data.mjs    cache/ -> data/
  verify.mjs        post-build checks
  smoke.sh          headless route smoke test
  verify-desktop.mjs  end-to-end checks against the packaged app
  build-desktop.sh  icons -> data -> verify -> compile -> bundle
  launch-debug.sh   run the exe with remote debugging on
  app-icon.mjs, make-ico.py  icon generation
  lib/              parsers, aligner, reading mining
src-tauri/          Tauri shell (Cargo.lock is committed on purpose)
data/               generated, gitignored
cache/              downloaded datasets, gitignored
```

## How it works

**Readings are aligned, not guessed.** For each word, the readings of the kanji
inside it are aligned against KANJIDIC2's on/kun lists with a Viterbi-style
pass, then cross-checked against readings mined from the furigana of every
example sentence. A reading only survives if both methods agree, which is what
lets the app say how a kanji is read *in a given word* rather than listing every
reading it could theoretically have. Verified at 99.01% agreement on a baseline
sample and 99.27% on held-out data.

**Levels come from OpenJLPT, not KANJIDIC2.** KANJIDIC2's `<jlpt>` tag is not
usable: 日, 学 and 大 are all tagged `4`, and most N1 kanji carry no tag at all.

**Recognition is template matching.** Each character is rasterised once into an
index (kanji from their KanjiVG stroke outlines, kana from filled glyph
outlines). A drawn stroke is normalised, then scored against every template in a
Web Worker, and candidates come back ranked.

## Attribution

The generated `data/` bundles are derived from these sources. The raw datasets
are not redistributed here — see the table above.

- **KANJIDIC2** — © EDRDG, [CC BY-SA 4.0](https://www.edrdg.org/wiki/EDRDG_License)
- **KanjiVG** — © Ulrich Apel, [CC BY-SA 3.0](https://github.com/KanjiVG/kanjivg)
- **JMdict** — © EDRDG, [CC BY-SA 4.0](https://www.edrdg.org/wiki/EDRDG_License),
  via the [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) JSON conversions
- **OpenJLPT** — © evanclan, [CC BY-SA 4.0](https://github.com/evanclan/OpenJLPT)
- **Kana stroke outlines** — [strokesvg](https://github.com/zhengkyl/strokesvg)
  (MIT), derived from [Klee One](https://github.com/fontworks-fonts/Klee)
  (SIL Open Font License 1.1)

If you redistribute this app or its data bundles, keep those credits.