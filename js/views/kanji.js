// Kanji views: the level browser grid and the character detail page.

import { el, clear, toast } from '../util.js';
import { data, progress, LEVEL_LABEL, LEVELS } from '../store.js';
import { kanjiGlyph } from '../strokes.js';
import { rubyWord, furiganaSentence } from '../furigana.js';

const ROMAJI_NOTE = {
  g: 'gu', z: 'zu', d: 'zu', b: 'bu', p: 'pu',
};

export async function render(segs, mount) {
  await data.loadIndex();

  if (!segs.length) return renderBrowser(mount, LEVELS[0]);
  if (segs.length === 1) return renderBrowser(mount, segs[0]);
  return renderDetail(segs[0], segs[1], mount);
}

/* ------------------------------------------------------------------ *
 * Level browser
 * ------------------------------------------------------------------ */

async function renderBrowser(mount, level) {
  if (!LEVELS.includes(level)) level = LEVELS[0];

  const head = el('div', { className: 'view-head' },
    el('h1', null, 'Kanji'),
    el('p', null, 'Work down from N5 to N1. Tap a character to see how it is read, written and used.'));

  const seg = el('div', { className: 'seg', role: 'group', 'aria-label': 'JLPT level' });
  for (const lv of LEVELS) {
    const meta = data.index.levels.find((l) => l.id === lv);
    seg.appendChild(el('button', {
      type: 'button',
      'aria-pressed': String(lv === level),
      onclick: () => { location.hash = `#/kanji/${lv}`; },
    }, LEVEL_LABEL[lv], el('span', { className: 'count' }, meta ? meta.count : '')));
  }

  mount.append(head, el('div', { className: 'row between' }, seg), el('div', { className: 'empty' }, 'Loading…'));

  const bundle = await data.loadLevel(level);
  const grid = el('div', { className: 'grid' });

  for (const k of bundle.kanji) {
    const known = progress.isKnown(k.c);
    const tile = el('a', {
      className: `tile${known ? ' known' : ''}`,
      href: `#/kanji/${level}/${encodeURIComponent(k.c)}`,
      title: `${k.c} — ${(k.mn || []).slice(0, 3).join(', ')}`,
    },
      el('span', { className: 'tile-ch' }, k.c),
      // The meaning and the stroke count share a row inside the tile. This used
      // to be absolutely positioned below the tile, where the grid's 8px gap
      // left it clipped and sitting on top of the next row of tiles.
      el('span', { className: 'tile-foot' },
        el('span', { className: 'tile-mean' }, (k.mn && k.mn[0]) || ''),
        k.n ? el('span', { className: 'tile-meta' }, k.n) : null));

    grid.appendChild(tile);
  }

  mount.lastChild.remove();
  mount.appendChild(grid);
  mount.appendChild(aboutPanel());
  return {};
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

async function renderDetail(level, char, mount) {
  const bundle = await data.loadLevel(LEVELS.includes(level) ? level : LEVELS[0]);
  const k = bundle.kanji.find((x) => x.c === char);

  if (!k) {
    mount.appendChild(el('div', { className: 'empty' }, `${char} is not in ${level.toUpperCase()}.`));
    return {};
  }

  const lv = k.lv || level;
  mount.appendChild(el('a', { className: 'back-link', href: `#/kanji/${lv}` }, '← All ' + LEVEL_LABEL[lv].toUpperCase()));

  /* -- glyph + player -- */
  const stage = el('div', { className: 'glyph-stage' });
  const playerBox = el('div', { className: 'player-host' });
  const glyphCard = el('div', { className: 'card glyph-card' }, stage, playerBox);

  const player = kanjiGlyph(stage, k.s, { grid: true });
  playerBox.appendChild(player.controls);

  /* -- readings -- */
  const facts = el('div', { className: 'facts' },
    fact('JLPT', LEVEL_LABEL[lv] || lv.toUpperCase()),
    fact('Strokes', k.n),
    fact('School grade', k.g ? `${k.g}` : '–'),
    fact('Radical', k.rad ? `${k.rad}` : '–'));

  const readings = el('div', { className: 'readings' },
    readingRow('on', 'On\u2019yomi', k.on, k.mc, k),
    readingRow('kun', 'Kun\u2019yomi', k.kun, k.mc, k));

  const meanings = (k.mn && k.mn.length)
    ? el('ul', { className: 'meanings' }, k.mn.map((m) => el('li', null, m)))
    : null;

  mount.appendChild(el('div', { className: 'detail-top' },
    glyphCard,
    el('div', null,
      el('h1', { style: { margin: '0 0 12px', fontSize: '30px' } }, k.c),
      readings,
      meanings,
      facts)));

  /* -- actions -- */
  const markBtn = el('button', { className: 'btn', type: 'button' });
  const syncMark = () => {
    const known = progress.isKnown(k.c);
    markBtn.textContent = known ? '✓ Known — undo' : 'Mark as known';
  };
  markBtn.addEventListener('click', () => {
    const known = progress.isKnown(k.c);
    progress.mark(k.c, !known);
    syncMark();
    toast(known ? 'Reset to learning' : 'Nice — spaced out to a longer gap');
  });
  syncMark();

  mount.appendChild(el('div', { className: 'row', style: { marginTop: '16px' } },
    markBtn,
    // Practising means watching the stroke order and tracing it, which is what
    // Learn to write is for. Draw to search is a different tool: it recognises
    // anything you scribble and is reachable from its own tab.
    el('a', { className: 'btn', href: `#/learn/${lv}/${encodeURIComponent(k.c)}` }, 'Practise drawing'),
    el('a', { className: 'btn', href: `#/study/${encodeURIComponent(k.c)}` }, 'Quiz me on this')));

  /* -- how it is read in practice -- */
  const context = readingContext(k);
  if (context) {
    mount.appendChild(el('section', { className: 'section' },
      el('h2', null, 'How it is actually read'),
      el('p', { className: 'hint' },
        'Every reading below is taken from real vocabulary. The bar shows how often this reading comes up, which is usually a better guide than the raw list above.'),
      context));
  }

  /* -- example sentences -- */
  if (k.ex && k.ex.length) {
    mount.appendChild(el('section', { className: 'section' },
      el('h2', null, 'In sentences'),
      el('p', { className: 'hint' }, 'Natural sentences from Tatoeba, with furigana.'),
      ...k.ex.map(([ja, fu, en]) => el('div', { className: 'sentence' },
        el('div', { className: 'ja' }, fu ? furiganaSentence(fu, k.c) : ja),
        el('div', { className: 'en' }, en)))));
  }

  return { destroy: () => player.destroy() };
}

function fact(k, v) {
  return el('div', { className: 'fact' }, el('div', { className: 'k' }, k), el('div', { className: 'v' }, v));
}

function readingRow(kind, label, list, top, k) {
  const pills = (list || []).map((r) =>
    el('span', { className: `reading-pill${r === top ? ' top' : ''}` },
      r,
      r === top ? el('span', { className: 'badge' }, 'common') : null));

  return el('div', { className: 'reading-row' },
    el('span', { className: 'label' }, label),
    el('div', { className: 'reading-list' }, pills.length ? pills : el('span', { style: { color: 'var(--ink-faint)', fontSize: '13px' } }, 'none listed')));
}

/**
 * Group the example words by the kana this character actually takes in them.
 *
 * The kana per character come from the build's alignment step, so each word can
 * be shown with real ruby and the studied character highlighted.
 */
function readingContext(k) {
  const words = k.w || [];
  if (!words.length) return null;

  // word: [text, reading, perChar, gloss, targetIndex]
  const groups = new Map();
  for (const w of words) {
    const [text, , perChar, gloss, at] = w;
    const kana = String(perChar).trim().split(/\s+/)[at];
    if (!kana) continue;
    if (!groups.has(kana)) groups.set(kana, []);
    groups.get(kana).push(w);
  }

  const max = Math.max(...[...groups.values()].map((v) => v.length));

  const sections = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kana, items]) => el('div', { className: 'reading-group' },
      el('div', { className: 'reading-group-head' },
        el('span', { className: 'kana' }, kana),
        el('span', { className: 'share' }, el('span', { style: { width: `${(items.length / max) * 100}%` } })),
        el('span', { className: 'n' }, `${items.length} word${items.length > 1 ? 's' : ''}`)),
      el('div', { className: 'word-list' },
        items.map((w) => el('div', { className: 'word-item' },
          rubyWord(w[0], w[2], w[4]),
          el('span', { className: 'gloss' }, w[3]))))));

  return el('div', null, sections);
}

/* ------------------------------------------------------------------ */

function aboutPanel() {
  const s = data.index.sources || [];
  return el('div', { className: 'about' },
    el('h2', null, 'Where this data comes from'),
    el('ul', null,
      s.map((src) => el('li', null, `${src.name} — ${src.use} (${src.licence})`)),
      el('li', null, 'Kana mnemonics written for this app.')),
    el('p', { style: { color: 'var(--ink-faint)', fontSize: '12.5px', marginTop: '10px' } },
      `Built ${data.index.built} · ${data.index.total} kanji across N5–N1, plus ${data.index.kana.hiragana} hiragana and ${data.index.kana.katakana} katakana.`));
}