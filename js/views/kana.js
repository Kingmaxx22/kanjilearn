// Kana views: gojuon tables and the per-kana detail page.

import { el } from '../util.js';
import { data } from '../store.js';
import { kanaGlyph } from '../strokes.js';
import { rubyWord } from '../furigana.js';

const SETS = { hira: 'Hiragana', kata: 'Katakana' };
const VOWEL_LABELS = ['a', 'i', 'u', 'e', 'o'];

// Written out rather than computed: the kana block is not laid out so that row
// and column can be turned into code point offsets, and hard-coding the grid
// keeps the chart correct and obvious.
const GOJUON = {
  hira: [
    ['', ['あ', 'い', 'う', 'え', 'お']],
    ['k', ['か', 'き', 'く', 'け', 'こ']],
    ['s', ['さ', 'し', 'す', 'せ', 'そ']],
    ['t', ['た', 'ち', 'つ', 'て', 'と']],
    ['n', ['な', 'に', 'ぬ', 'ね', 'の']],
    ['h', ['は', 'ひ', 'ふ', 'へ', 'ほ']],
    ['m', ['ま', 'み', 'む', 'め', 'も']],
    ['y', ['や', null, 'ゆ', null, 'よ']],
    ['r', ['ら', 'り', 'る', 'れ', 'ろ']],
    ['w', ['わ', 'ゐ', null, 'ゑ', 'を']],
    ['g', ['が', 'ぎ', 'ぐ', 'げ', 'ご']],
    ['z', ['ざ', 'じ', 'ず', 'ぜ', 'ぞ']],
    ['d', ['だ', 'ぢ', 'づ', 'で', 'ど']],
    ['b', ['ば', 'び', 'ぶ', 'べ', 'ぼ']],
    ['p', ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ']],
  ],
  kata: [
    ['', ['ア', 'イ', 'ウ', 'エ', 'オ']],
    ['k', ['カ', 'キ', 'ク', 'ケ', 'コ']],
    ['s', ['サ', 'シ', 'ス', 'セ', 'ソ']],
    ['t', ['タ', 'チ', 'ツ', 'テ', 'ト']],
    ['n', ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ']],
    ['h', ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ']],
    ['m', ['マ', 'ミ', 'ム', 'メ', 'モ']],
    ['y', ['ヤ', null, 'ユ', null, 'ヨ']],
    ['r', ['ラ', 'リ', 'ル', 'レ', 'ロ']],
    ['w', ['ワ', 'ヰ', null, 'ヱ', 'ヲ']],
    ['g', ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ']],
    ['z', ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ']],
    ['d', ['ダ', 'ヂ', 'ヅ', 'デ', 'ド']],
    ['b', ['バ', 'ビ', 'ブ', 'ベ', 'ボ']],
    ['p', ['パ', 'ピ', 'プ', 'ペ', 'ポ']],
  ],
};

const EXTRA_TITLE = {
  hira: 'Small kana, ん, and ゔ',
  kata: 'Small kana, ン, ヴ and ヵヶ',
};

export async function render(segs, mount) {
  await data.loadKana();
  if (segs.length >= 2) return renderKana(segs[0], segs[1], mount);
  return renderTables(mount, segs[0] || 'hira');
}

/* ------------------------------------------------------------------ *
 * Chart
 * ------------------------------------------------------------------ */

function renderTables(mount, set) {
  if (!SETS[set]) set = 'hira';

  mount.appendChild(el('div', { className: 'view-head' },
    el('h1', null, SETS[set]),
    el('p', null, 'The kana chart. Tap any character for its stroke order, sound and example words.')));

  mount.appendChild(el('div', { className: 'seg' },
    el('button', { type: 'button', 'aria-pressed': String(set === 'hira'), onclick: () => { location.hash = '#/kana/hira'; } }, 'ひらがな  Hiragana'),
    el('button', { type: 'button', 'aria-pressed': String(set === 'kata'), onclick: () => { location.hash = '#/kana/kata'; } }, 'カタカナ  Katakana')));

  const list = data.kana[set === 'hira' ? 'hiragana' : 'katakana'];
  const byChar = new Map(list.map((k) => [k.c, k]));

  const grid = el('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: '30px repeat(5, minmax(62px, 1fr))',
      gap: '6px',
      marginTop: '16px',
      minWidth: '360px',
    },
  });

  grid.appendChild(el('div'));
  for (const v of VOWEL_LABELS) {
    grid.appendChild(el('div', {
      style: { textAlign: 'center', fontSize: '12px', color: 'var(--ink-faint)', fontWeight: '700' },
    }, v));
  }

  const charted = new Set();

  for (const [rowLabel, chars] of GOJUON[set]) {
    grid.appendChild(el('div', {
      style: { display: 'flex', alignItems: 'center', fontSize: '11px', color: 'var(--ink-faint)', fontWeight: '700' },
    }, rowLabel));

    for (const ch of chars) {
      if (!ch) {
        grid.appendChild(el('div', { style: { height: '62px' } }));
        continue;
      }
      const entry = byChar.get(ch);
      charted.add(ch);
      grid.appendChild(entry ? kanaCell(set, entry) : el('div', { style: { height: '62px' } }));
    }
  }

  mount.appendChild(el('div', { className: 'card', style: { padding: '14px', overflowX: 'auto' } }, grid));

  const rest = list.filter((k) => !charted.has(k.c));
  if (rest.length) {
    mount.appendChild(el('section', { className: 'section' },
      el('h2', null, EXTRA_TITLE[set]),
      el('p', { className: 'hint' }, 'The small kana are written smaller and often sit after another character.'),
      el('div', { className: 'kana-grid' }, rest.map((k) => kanaCell(set, k)))));
  }

  return {};
}

function kanaCell(set, k) {
  return el('a', { className: 'kana-cell', href: `#/kana/${set}/${encodeURIComponent(k.c)}` },
    el('span', { className: 'ch' }, k.c),
    el('span', { className: 'ro' }, k.r || ''));
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

function renderKana(set, char, mount) {
  if (!SETS[set]) set = 'hira';
  const list = data.kana[set === 'hira' ? 'hiragana' : 'katakana'];
  let k = list.find((x) => x.c === char);
  let actualSet = set;
  if (!k) {
    // Allow linking across scripts, e.g. from hiragana to katakana.
    const other = set === 'hira' ? 'katakana' : 'hiragana';
    k = data.kana[other].find((x) => x.c === char) || null;
    actualSet = other;
  }

  if (!k) {
    mount.appendChild(el('div', { className: 'empty' }, `${char} is not in this table.`));
    return {};
  }

  mount.appendChild(el('a', { className: 'back-link', href: `#/kana/${actualSet}` }, `← ${SETS[actualSet]}`));

  const stage = el('div', { className: 'glyph-stage' });
  const playerBox = el('div', { className: 'player-host' });
  const glyphCard = el('div', { className: 'card glyph-card' }, stage, playerBox);

  let player = null;
  if (k.svg) {
    player = kanaGlyph(stage, k.svg);
    if (player) playerBox.appendChild(player.controls);
  } else {
    // No stroke data for this one; fall back to the character itself.
    stage.appendChild(el('div', {
      style: {
        display: 'grid', placeItems: 'center', height: '100%',
        fontFamily: 'var(--japanese)', fontSize: '150px',
      },
    }, k.c));
  }

  const info = el('div', null,
    el('h1', { style: { margin: '0 0 10px', fontSize: '32px' } },
      k.c,
      k.r ? el('span', {
        style: { fontSize: '20px', color: 'var(--ink-soft)', marginLeft: '12px', fontFamily: 'var(--ui)', fontWeight: '500' },
      }, k.r) : null),
    el('div', { className: 'facts' },
      fact('Strokes', k.n || '–'),
      fact('Script', SETS[actualSet]),
      k.base ? fact('Base', k.base) : null));

  if (k.m) info.appendChild(el('p', { style: { marginTop: '14px', fontSize: '16px', color: 'var(--ink-soft)' }, html: k.m }));

  mount.appendChild(el('div', { className: 'detail-top' }, glyphCard, info));

  if (k.ex && k.ex.length) {
    mount.appendChild(el('section', { className: 'section' },
      el('h2', null, 'Seen in these words'),
      el('p', { className: 'hint' }, 'Real words taken from the JLPT vocabulary list.'),
      el('div', { className: 'word-list' },
        k.ex.map(([w, r, g]) => {
          const chars = [...w];
          const at = chars.indexOf(k.c);
          return el('div', { className: 'word-item' },
            rubyWord(w, alignSimple(w, r), at),
            el('span', { className: 'gloss' }, g));
        }))));
  }

  // The same sound in the other script is worth one click.
  const twin = k.r
    ? data.kana[actualSet === 'hira' ? 'katakana' : 'hiragana'].find((x) => x.r === k.r)
    : null;

  mount.appendChild(el('div', { className: 'row', style: { marginTop: '20px' } },
    // Practising means watching the stroke order and tracing it, which is what
    // Learn to write is for. Draw to search is a different tool: it recognises
    // anything you scribble and is reachable from its own tab.
    el('a', { className: 'btn', href: `#/learn/${actualSet}/${encodeURIComponent(k.c)}` }, 'Practise drawing'),
    twin ? el('a', { className: 'btn', href: `#/kana/${actualSet === 'hira' ? 'kata' : 'hira'}/${encodeURIComponent(twin.c)}` },
      `Same sound: ${twin.c}`) : null,
    el('a', { className: 'btn', href: '#/kanji/n5' }, 'Back to kanji')));

  return { destroy: () => player && player.destroy() };
}

function fact(k, v) {
  return el('div', { className: 'fact' }, el('div', { className: 'k' }, k), el('div', { className: 'v' }, v));
}

/**
 * Rough per-character kana split for a short example word, so we can put ruby
 * over it. Only used for kana examples; kanji words use the build's alignment.
 */
function alignSimple(word, reading) {
  const chars = [...word];
  const kana = [...reading];
  if (chars.length !== kana.length) return '';
  const parts = [];
  for (let i = 0; i < chars.length; i++) {
    if (/[\u3400-\u9fff]/.test(chars[i]) && /[\u3040-\u30ff]/.test(kana[i])) parts.push(kana[i]);
  }
  return parts.join(' ');
}