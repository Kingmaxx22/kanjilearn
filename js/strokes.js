// Stroke order playback.
//
// Two data shapes have to animate the same way:
//
//   kanji  KanjiVG gives one centre-line path per stroke in a 109x109 box,
//          stroked with a fat round pen to form the character.
//   kana   strokesvg gives a whole SVG whose centre-lines carry clip paths, so
//          the paths cannot simply be re-used -- the markup is injected and the
//          strokes revealed inside it.
//
// Both end up as "an ordered list of SVG elements I can partly draw".

import { el, clear } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Length of a stroke element, summing parts when it is a <g>. */
function strokeLength(node) {
  if (node.tagName.toLowerCase() === 'path') {
    try { return node.getTotalLength(); } catch { return 0; }
  }
  let total = 0;
  for (const p of node.querySelectorAll('path')) {
    try { total += p.getTotalLength(); } catch { /* detached */ }
  }
  return total;
}

function strokeParts(node) {
  return node.tagName.toLowerCase() === 'path' ? [node] : [...node.querySelectorAll('path')];
}

export function strokePlayer(container, { speed = 1, onState = null, dot = null } = {}) {
  let strokes = [];          // ordered SVG elements
  let lengths = [];
  let position = 0;          // how many strokes drawn, plus fraction of the next
  let playing = false;
  let raf = null;
  let speedRef = speed;

  const counter = el('span', { className: 'stroke-progress' }, '–');
  const btnReset = playerButton('⏮', 'Start over', () => { pause(); api.seek(0); });
  const btnPrev = playerButton('◀', 'Previous stroke', () => { pause(); api.seek(Math.max(0, Math.floor(position) - 1)); });
  const btnPlay = playerButton('▶', 'Play', toggle);
  const btnNext = playerButton('▶|', 'Next stroke', () => { pause(); api.seek(Math.min(strokes.length, Math.ceil(position) + 1)); });
  const btnAll = playerButton('▦', 'Show all strokes', () => { pause(); api.seek(strokes.length); });
  const btnSpeed = playerButton('1×', 'Playback speed', () => {
    speedRef = speedRef === 1 ? 2 : speedRef === 2 ? 0.5 : 1;
    btnSpeed.textContent = `${speedRef}×`;
  });

  const bar = el('div', { className: 'player' },
    btnReset, btnPrev, btnPlay, btnNext, btnAll,
    el('span', { className: 'spacer' }), btnSpeed, counter);

  function playerButton(label, title, onClick) {
    return el('button', { type: 'button', title, 'aria-label': title, onclick: onClick }, label);
  }

  const api = {
    /** Attach an ordered list of stroke elements and draw them. */
    load(elements) {
      strokes = elements;
      lengths = elements.map(strokeLength);
      position = 0;
      paint();
    },
    play: () => { if (!playing) { playing = true; btnPlay.textContent = '❚❚'; step(); } },
    pause,
    seek,
    step: () => seek(Math.floor(position) + 1),
    reset: () => { pause(); seek(0); },
    showAll: () => { pause(); seek(strokes.length); },
    get count() { return strokes.length; },
    destroy() { pause(); },
    controls: bar,
  };

  /** Jump to a stroke count; the fraction part is what animates. */
  function seek(n) {
    position = Math.max(0, Math.min(strokes.length, n));
    paint();
  }

  function toggle() { playing ? pause() : api.play(); }

  function pause() {
    playing = false;
    btnPlay.textContent = '▶';
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  // ~700ms per stroke at 1x, which is roughly how fast the character is written.
  const STROKE_MS = 700;

  function step() {
    if (!playing) return;
    if (position >= strokes.length) { pause(); return; }

    const start = performance.now();
    const from = position;
    const target = Math.min(strokes.length, from + 1);
    const duration = STROKE_MS / speedRef;

    const tick = (now) => {
      if (!playing) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
      position = from + (target - from) * eased;
      paint();

      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        position = target;
        paint();
        raf = requestAnimationFrame(() => { if (playing) step(); });
      }
    };
    raf = requestAnimationFrame(tick);
  }

  function paint() {
    const whole = Math.floor(position);
    const frac = position - whole;

    strokes.forEach((node, i) => {
      const parts = strokeParts(node);
      if (i < whole) {
        for (const p of parts) { p.style.strokeDasharray = 'none'; p.style.strokeDashoffset = '0'; }
        return;
      }
      if (i > whole) {
        for (const p of parts) {
          const len = p.getTotalLength ? safeLength(p) : 0;
          p.style.strokeDasharray = `${len} ${len + 1}`;
          p.style.strokeDashoffset = `${len}`;
        }
        return;
      }
      // The stroke being drawn right now.
      for (const p of parts) {
        const len = safeLength(p);
        p.style.strokeDasharray = `${len} ${len + 1}`;
        p.style.strokeDashoffset = `${len * (1 - frac)}`;
      }
    });

    // Pen tip on the active stroke.
    const active = strokes[whole];
    if (dot) {
      if (active && frac > 0 && frac < 1) {
        const first = strokeParts(active)[0];
        try {
          const pt = first.getPointAtLength(safeLength(first) * frac);
          dot.setAttribute('cx', pt.x);
          dot.setAttribute('cy', pt.y);
          dot.setAttribute('opacity', '1');
        } catch { dot.setAttribute('opacity', '0'); }
      } else {
        dot.setAttribute('opacity', '0');
      }
    }

    const shown = whole + (frac > 0 ? 1 : 0);
    counter.textContent = strokes.length ? `${Math.min(shown, strokes.length)} / ${strokes.length}` : '–';
    if (onState) onState({ position, total: strokes.length, playing });
  }

  function safeLength(p) {
    try { return p.getTotalLength(); } catch { return 0; }
  }

  return api;
}

/* ---- kanji ---------------------------------------------------------- */

/**
 * Render KanjiVG stroke paths with a practice grid and a player.
 * Returns the player plus the stage element.
 */
export function kanjiGlyph(stage, paths, { grid = true } = {}) {
  clear(stage);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 109 109');
  svg.setAttribute('role', 'img');

  if (grid) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'glyph-guide');
    for (const [x1, y1, x2, y2] of [[0, 54.5, 109, 54.5], [54.5, 0, 54.5, 109]]) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'glyph-guide dash');
      g.appendChild(line);
    }
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', 2.5); rect.setAttribute('y', 2.5);
    rect.setAttribute('width', 104); rect.setAttribute('height', 104);
    rect.setAttribute('rx', 3);
    g.appendChild(rect);
    svg.appendChild(g);
  }

  const ink = document.createElementNS(SVG_NS, 'g');
  ink.setAttribute('fill', 'none');
  ink.setAttribute('stroke', 'currentColor');
  ink.setAttribute('stroke-width', '6');
  ink.setAttribute('stroke-linecap', 'round');
  ink.setAttribute('stroke-linejoin', 'round');

  const elements = paths.map((d) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    ink.appendChild(p);
    return p;
  });

  svg.appendChild(ink);

  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'pen-dot');
  dot.setAttribute('r', '4.5');
  dot.setAttribute('opacity', '0');
  svg.appendChild(dot);

  stage.appendChild(svg);

  const player = strokePlayer(stage, { dot });
  player.load(elements);
  player.showAll();

  return player;
}

/* ---- kana ----------------------------------------------------------- */

let kanaUid = 0;

/**
 * Inject a strokesvg kana and reveal its strokes one at a time.
 *
 * Ids are rewritten per instance because several kana can be on screen at once
 * and the clip paths reference ids in the "shadows" group.
 */
export function kanaGlyph(stage, markup, { ghost = true } = {}) {
  clear(stage);

  const uid = `k${++kanaUid}`;
  const scoped = markup.replace(/id="([\w-]+)"/g, (_, id) => `id="${uid}-${id}"`)
    .replace(/url\(#([\w-]+)\)/g, (_, id) => `url(#${uid}-${id})`)
    .replace(/href="#([\w-]+)"/g, (_, id) => `href="#${uid}-${id}"`);

  // The stored markup is the *inside* of an <svg>. Assigning it to a div would
  // parse it in HTML context, where <g> and <path> are not SVG elements and have
  // no geometry, so getTotalLength() fails. Parse it as SVG instead.
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 1024 1024">${scoped}</svg>`,
    'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    stage.appendChild(el('div', {
      style: { display: 'grid', placeItems: 'center', height: '100%', fontFamily: 'var(--japanese)', fontSize: '150px' },
    }, markup.charAt(0) || '?'));
    return null;
  }

  const svg = document.importNode(doc.documentElement, true);
  stage.appendChild(svg);

  const shadows = svg.querySelector('[data-strokesvg="shadows"]');
  const strokesGroup = svg.querySelector('[data-strokesvg="strokes"]');

  if (shadows) {
    // Show the whole character faintly so it is clear what is being drawn.
    shadows.setAttribute('fill', 'var(--line)');
    shadows.style.fill = 'var(--line)';
    shadows.style.opacity = ghost ? '1' : '0';
  }
  if (strokesGroup) {
    strokesGroup.style.stroke = 'currentColor';
    strokesGroup.style.fill = 'none';
    if (!strokesGroup.getAttribute('stroke-width')) strokesGroup.style.strokeWidth = '110';
  }

  // Each direct child of the strokes group is one stroke, in order.
  const elements = strokesGroup ? [...strokesGroup.children].filter((n) => n.hasAttribute('style') || n.tagName.toLowerCase() === 'path' || n.tagName.toLowerCase() === 'g') : [];

  const player = strokePlayer(stage);
  player.load(elements);
  player.showAll();

  return player;
}

/**
 * A flat filled silhouette, for characters whose only usable geometry is an
 * outline (kana, whose centre-lines carry clip paths). There is no stroke order
 * to play back, so this is not a player -- it is for the draw-pad ghost.
 */
export function outlineGlyph(stage, paths, { box = 1024 } = {}) {
  clear(stage);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${box} ${box}`);
  svg.setAttribute('role', 'img');

  const ink = document.createElementNS(SVG_NS, 'g');
  ink.setAttribute('fill', 'currentColor');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    ink.appendChild(p);
  }
  svg.appendChild(ink);
  stage.appendChild(svg);
}

/** A plain, non-interactive glyph for grids and lists. */
export function staticGlyph(char, { className = 'tile' } = {}) {
  return el('a', { className, href: '#/kanji' }, char);
}