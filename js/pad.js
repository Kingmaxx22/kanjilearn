// The 田字格 practice pad.
//
// Both draw-to-search and the Learn tab draw on the same box: it is how kanji
// are actually written, and it is also exactly the frame the recognizer built
// its templates in, so a drawing here can be compared to a target directly.
// Keeping the canvas in one place means the grid, the pen colour and the ghost
// behave the same in both places.

import { el } from './util.js';
import { kanjiGlyph, outlineGlyph } from './strokes.js';

export const PAD = 320;   // drawing resolution in CSS pixels, scaled by DPR

/**
 * The pen colour comes from CSS so it follows the theme. A canvas keeps
 * whatever is drawn on it, so the variable is read at paint time rather than
 * captured once.
 */
export function inkColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--pad-ink').trim() || '#24211d';
}

/**
 * A drawing surface with a practice grid.
 *
 * @param diagonals  draw the two diagonals; they help with characters built on
 *                   a cross, and are only shown when a ghost is loaded
 * @param onEnd      called after every finished stroke, with the stroke list
 * @param enabled    start disabled, for callers waiting on a worker
 */
export function createPad({ diagonals = false, onEnd = () => {}, enabled = true } = {}) {
  const canvas = el('canvas', { className: 'pad', width: PAD, height: PAD });
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = PAD * dpr;
  canvas.height = PAD * dpr;
  ctx.scale(dpr, dpr);

  let strokes = [];
  let drawing = null;
  let live = enabled;

  /* -- painting -------------------------------------------------------- */

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD, PAD);
    ctx.strokeStyle = 'rgba(128,128,128,0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD / 2, 0); ctx.lineTo(PAD / 2, PAD);
    ctx.moveTo(0, PAD / 2); ctx.lineTo(PAD, PAD / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(128,128,128,0.45)';
    ctx.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);

    if (diagonals) {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(PAD, PAD);
      ctx.moveTo(PAD, 0); ctx.lineTo(0, PAD);
      ctx.stroke();
    }

    ctx.strokeStyle = inkColour();
    ctx.lineWidth = Math.max(10, PAD * 0.055);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) strokePath(s);
  }

  /** One stroke, nudged if it was a tap so a dot still shows. */
  function strokePath(s) {
    ctx.beginPath();
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.01, s[0][1]);
    ctx.stroke();
  }

  /* -- input ----------------------------------------------------------- */

  function pointOf(event) {
    const r = canvas.getBoundingClientRect();
    return [
      ((event.clientX - r.left) / r.width) * PAD,
      ((event.clientY - r.top) / r.height) * PAD,
    ];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!live) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = [pointOf(e)];
    strokes.push(drawing);
    paint();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.push(pointOf(e));
    paint();
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = null;
    paint();
    onEnd(strokes);
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  /* -- ghost ----------------------------------------------------------- */

  let ghostStage = null;

  /** Lay a character behind the pad as a tracing guide. */
  function setGhost(entry, opacity = 0.16) {
    if (!entry) return;
    if (!ghostStage) {
      // The ghost is positioned against the pad's wrapper, so the canvas has
      // to be in the document before this is called.
      const host = canvas.parentElement;
      if (!host) throw new Error('setGhost called before the pad was added to the page');
      ghostStage = el('div', {
        className: 'glyph-stage pad-ghost',
        style: { opacity: String(opacity) },
      });
      host.style.position = 'relative';
      host.appendChild(ghostStage);
    }
    const [, kind, ...paths] = entry;
    if (kind === 0) kanjiGlyph(ghostStage, paths, { grid: false });
    else outlineGlyph(ghostStage, paths);
    diagonals = true;
    paint();
  }

  const themeWatch = new MutationObserver(() => paint());
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  paint();

  return {
    canvas,
    get strokes() { return strokes; },
    set enabled(v) { live = v; },
    get enabled() { return live; },
    setGhost,
    showGhost(v) { if (ghostStage) ghostStage.style.opacity = v ? '0.16' : '0'; },
    undo() { strokes.pop(); paint(); onEnd(strokes); },
    clear() { strokes = []; paint(); onEnd(strokes); },
    repaint: paint,
    destroy() { themeWatch.disconnect(); },
  };
}

/**
 * Rasterise strokes at template resolution so they can be compared to a
 * character. The strokes are re-drawn in white on a transparent canvas, so the
 * result does not depend on the theme or on the pen colour.
 */
const probe = el('canvas', { width: 48, height: 48 });
const probeCtx = probe.getContext('2d', { willReadFrequently: true });

export function rasterise(strokes, res = probe.width) {
  if (probe.width !== res) { probe.width = res; probe.height = res; }
  probeCtx.setTransform(1, 0, 0, 1, 0, 0);
  probeCtx.clearRect(0, 0, res, res);
  // The pad is PAD units square and the template is res units square, so this
  // maps a drawing onto the frame the recognizer rasterised the character in.
  probeCtx.scale(res / PAD, res / PAD);
  probeCtx.strokeStyle = '#fff';
  probeCtx.lineWidth = Math.max(10, PAD * 0.055);
  probeCtx.lineCap = 'round';
  probeCtx.lineJoin = 'round';
  for (const s of strokes) {
    probeCtx.beginPath();
    s.forEach(([x, y], i) => (i ? probeCtx.lineTo(x, y) : probeCtx.moveTo(x, y)));
    if (s.length === 1) probeCtx.lineTo(s[0][0] + 0.01, s[0][1]);
    probeCtx.stroke();
  }
  return probeCtx.getImageData(0, 0, res, res).data;
}