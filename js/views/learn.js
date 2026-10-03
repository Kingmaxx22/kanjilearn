// Learn to write.
//
// Two halves. The picker is a grid of every character that has stroke data, so
// you can go straight to the one you are practising instead of hunting for it.
// The practice page puts the animated stroke order next to a tracing pad and
// scores the tracing against the target, so "did I get it right" is answered
// immediately instead of by eye.
//
// The score is deliberately the same measurement draw-to-search makes: the
// drawing is rasterised into the template frame and compared with the target's
// own bitmap. Building an index for one character is instant, so there is no
// worker and nothing to wait for.

import { el, clear } from '../util.js';
import { data, learned, LEVEL_LABEL, LEVELS } from '../store.js';
import { kanjiGlyph, kanaGlyph } from '../strokes.js';
import { createPad, rasterise } from '../pad.js';
import { buildIndex, createMatcher, RES, packBitmap, histogram } from '../recognizer.js';

// Measured, not guessed. Replaying a target's own geometry through the pad, and
// then adding enough wobble to look genuinely hand-drawn:
//
//   kanji  correct 84-97%   lookalikes (田 目 白 旧 旦) 47-60%
//   kana   correct 68-74%   other kana (い う え お か き) 44-55%
//
// Each mark sits in the middle of its gap, so a character drawn badly still
// passes and a different one does not.
//
// The kana scores are lower across the board because the kana template is the
// character's filled brush outline while a trace is drawn with a fixed-width pen
// along the centre lines. The two can never coincide, so kana top out well
// below kanji even when the tracing is perfect.
const PASS = { kanji: 0.72, kana: 0.6 };

const KANA_SETS = { hira: 'Hiragana', kata: 'Katakana' };

/** Every scope the picker offers, in the order they are shown. */
const SCOPES = [
  { id: 'hira', label: 'ひらがな', kind: 'kana' },
  { id: 'kata', label: 'カタカナ', kind: 'kana' },
  ...LEVELS.map((lv) => ({ id: lv, label: LEVEL_LABEL[lv], kind: 'kanji' })),
];

export async function render(segs, mount) {
  await data.loadIndex();

  const scope = SCOPES.some((s) => s.id === segs[0]) ? segs[0] : 'hira';
  const char = segs[1] || null;

  return char
    ? renderPractice(scope, char, mount)
    : renderPicker(scope, mount);
}

/* ------------------------------------------------------------------ *
 * Picker
 * ------------------------------------------------------------------ */

async function renderPicker(scope, mount) {
  const chars = await charactersIn(scope);
  const done = chars.filter((k) => learned.has(k.c)).length;

  mount.appendChild(el('div', { className: 'view-head' },
    el('h1', null, 'Learn to write'),
    el('p', null, 'Watch the stroke order, then trace it on the pad. Pick any character to practise it.')));

  const seg = el('div', { className: 'seg learn-seg', role: 'group', 'aria-label': 'Character set' });
  for (const s of SCOPES) {
    seg.appendChild(el('button', {
      type: 'button',
      'aria-pressed': String(s.id === scope),
      onclick: () => { location.hash = `#/learn/${s.id}`; },
    }, s.label));
  }

  const summary = done === chars.length && chars.length
    ? `All ${chars.length} practised.`
    : `${done} of ${chars.length} practised.`;

  mount.appendChild(el('div', { className: 'row between learn-bar' }, seg, el('span', { className: 'hint' }, summary)));
  mount.appendChild(el('div', { className: 'learn-grid' },
    chars.map((k) => el('a', {
      className: `learn-cell${learned.has(k.c) ? ' done' : ''}`,
      href: `#/learn/${scope}/${encodeURIComponent(k.c)}`,
      title: `${k.c}${k.n ? ` — ${k.n} strokes` : ''}`,
    },
      el('span', { className: 'ch' }, k.c),
      k.n ? el('span', { className: 'n' }, k.n) : null))));

  return {};
}

/** The characters in a scope, with their stroke counts. */
async function charactersIn(scope) {
  const meta = SCOPES.find((s) => s.id === scope);
  if (meta.kind === 'kana') {
    await data.loadKana();
    const list = scope === 'hira' ? data.kana.hiragana : data.kana.katakana;
    return list.map((k) => ({ c: k.c, n: k.n }));
  }
  const bundle = await data.loadLevel(scope);
  return bundle.kanji.map((k) => ({ c: k.c, n: k.n }));
}

/* ------------------------------------------------------------------ *
 * Practice
 * ------------------------------------------------------------------ */

async function renderPractice(scope, char, mount) {
  const meta = SCOPES.find((s) => s.id === scope);
  const isKana = meta.kind === 'kana';

  const entry = isKana ? await kanaEntry(scope, char) : await kanjiEntry(scope, char);

  if (!entry) {
    mount.appendChild(el('a', { className: 'back-link', href: `#/learn/${scope}` }, `← ${scopeLabel(scope)}`));
    mount.appendChild(el('div', { className: 'empty' }, `${char} is not in ${scopeLabel(scope)}.`));
    return {};
  }

  mount.appendChild(el('a', { className: 'back-link', href: `#/learn/${scope}` }, `← ${scopeLabel(scope)}`));

  /* -- stroke order -- */

  const stage = el('div', { className: 'glyph-stage' });
  const playerBox = el('div', { className: 'player-host' });
  // Opening a character plays its stroke order straight away: the point of the
  // page is to watch how it is written before tracing it.
  const player = isKana
    ? kanaGlyph(stage, entry.markup, { autoplay: true })
    : kanjiGlyph(stage, entry.paths, { grid: true, autoplay: true });

  // A player with nothing to play (a kana with no stroke data) leaves an empty
  // control bar behind, which reads as a broken button row.
  if (player) playerBox.appendChild(player.controls);

  /* -- tracing -- */

  const strokeIndex = data.strokesIndex || await data.loadStrokes();
  const ghostEntry = strokeIndex.find((e) => e[0] === char.codePointAt(0)) || null;

  const pad = createPad({ onEnd: score });

  const verdict = el('div', { className: 'verdict' }, 'Trace the character, then check.');

  const scoreRow = el('div', { className: 'pad-tools' },
    el('button', { className: 'btn', type: 'button', onclick: () => pad.undo() }, 'Undo stroke'),
    el('button', { className: 'btn', type: 'button', onclick: () => pad.clear() }, 'Clear'));

  // Only the target's own templates are needed, so this is a few milliseconds
  // of work rather than the full index.
  let matcher = null;
  buildIndex([ghostEntry]).then((index) => { matcher = createMatcher(index); }).catch(() => { matcher = null; });

  function score(strokes) {
    if (!matcher) return;
    if (!strokes.length) {
      verdict.className = 'verdict';
      verdict.textContent = 'Trace the character, then check.';
      return;
    }

    const img = rasterise(strokes, RES);
    const [best] = matcher({ bitmaps: packBitmap(img), hist: histogram(img), strokes: strokes.length }, 1);
    const pct = best ? Math.round(Math.max(0, Math.min(1, best.confidence)) * 100) : 0;
    const pass = best && best.confidence >= PASS[isKana ? 'kana' : 'kanji'];

    verdict.className = `verdict ${pass ? 'pass' : 'near'}`;
    clear(verdict);
    verdict.append(
      el('span', { className: 'pct' }, `${pct}%`),
      el('span', null, pass ? ' — that reads as ' + char : ' — not quite ' + char + ' yet. Watch the animation and try again.'),
    );

    if (pass) learned.mark(char, pct);
  }

  const practised = learned.get(char);
  const info = el('div', null,
    el('h1', { className: 'learn-title' }, char,
      isKana && entry.reading ? el('span', { className: 'reading' }, entry.reading) : null),
    el('p', { className: 'hint' },
      `${entry.strokes} stroke${entry.strokes === 1 ? '' : 's'}. Play it, step through it a stroke at a time, then trace it below.`),
    practised
      ? el('p', { className: 'learn-done' }, `✓ Best attempt ${practised.best}%`)
      : el('p', { className: 'hint' }, 'Not traced yet.'));

  mount.appendChild(el('div', { className: 'detail-top' },
    el('div', { className: 'card glyph-card' }, stage, playerBox),
    info));

  mount.appendChild(el('section', { className: 'section' },
    el('h2', null, 'Now trace it'),
    el('p', { className: 'hint' }, 'The character sits faintly behind the box. Fill it the way you would on paper.'),
    el('div', { className: 'draw-layout' },
      el('div', null,
        el('div', { className: 'pad-wrap' }, pad.canvas),
        scoreRow,
        verdict),
      el('div', null,
        el('h2', { style: { margin: '0 0 4px', fontSize: '15px' } }, 'Where to go next'),
        el('p', { className: 'hint' }, 'Reading and meaning are on the detail page.'),
        el('div', { className: 'row' },
          detailHref(char) ? el('a', { className: 'btn', href: detailHref(char) }, 'Open detail page') : null,
          el('a', { className: 'btn', href: `#/draw/${encodeURIComponent(char)}` }, 'Freehand draw'))))));

  // After mounting: the ghost is positioned against the pad's wrapper.
  if (ghostEntry) pad.setGhost(ghostEntry, 0.3);

  return {
    destroy() {
      if (player) player.destroy();
      pad.destroy();
    },
  };
}

function scopeLabel(scope) {
  const meta = SCOPES.find((s) => s.id === scope);
  return meta.kind === 'kana' ? KANA_SETS[scope] : `All ${LEVEL_LABEL[scope]}`;
}

/** The kana record, with its stroke count and strokesvg markup. */
async function kanaEntry(scope, char) {
  await data.loadKana();
  const list = scope === 'hira' ? data.kana.hiragana : data.kana.katakana;
  const k = list.find((x) => x.c === char);
  if (!k || !k.svg) return null;
  return { markup: k.svg, strokes: k.n || 0, reading: k.r };
}

/** The kanji record, with its stroke paths from the level bundle. */
async function kanjiEntry(scope, char) {
  const bundle = await data.loadLevel(scope);
  const k = bundle.kanji.find((x) => x.c === char);
  if (!k || !k.s || !k.s.length) return null;
  return { paths: k.s, strokes: k.n || k.s.length };
}

/** Kanji have a level page and kana a kana page; both are one tap away. */
function detailHref(char) {
  const lv = (data.index.levelOf || {})[char];
  if (lv) return `#/kanji/${lv}/${encodeURIComponent(char)}`;
  if (/[\u3041-\u30ff]/.test(char)) {
    return `#/kana/${/\u30a1/.test(char) ? 'kata' : 'hira'}/${encodeURIComponent(char)}`;
  }
  return null;
}