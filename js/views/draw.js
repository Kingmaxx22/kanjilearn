// Draw to search.
//
// The pad is a 田字格 practice box, which is also exactly how kanji are drawn, so
// whatever the user draws maps straight onto the template frame the recognizer
// was built with. Recognition runs after every stroke, so the candidate list
// narrows as they write rather than only at the end.

import { el } from '../util.js';
import { data } from '../store.js';
import { kanjiGlyph, outlineGlyph } from '../strokes.js';
import { RES, packBitmap, histogram } from '../recognizer.js';

const PAD = 320;          // drawing resolution (CSS pixels, scaled by DPR)

/**
 * The pen colour comes from CSS so it follows the theme. A canvas keeps
 * whatever was drawn on it, so the variable is read at paint time rather than
 * captured once.
 */
function inkColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--pad-ink').trim() || '#24211d';
}

export async function render(segs, mount) {
  await data.loadIndex();
  // A target character is drawn as a faint ghost behind the pad. Its geometry
  // comes from the same flat stroke index the recognizer uses, so showing a
  // ghost does not mean fetching a whole level bundle.
  const targetChar = segs[0] || null;
  const ghostEntry = targetChar
    ? (data.strokesIndex || await data.loadStrokes()).find((e) => e[0] === targetChar.codePointAt(0))
    : null;

  const pad = el('canvas', { className: 'pad', width: PAD, height: PAD });
  const ctx = pad.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  pad.width = PAD * dpr;
  pad.height = PAD * dpr;
  ctx.scale(dpr, dpr);

  const undoBtn = el('button', { className: 'btn', type: 'button', onclick: undo }, 'Undo stroke');
  const clearBtn = el('button', { className: 'btn', type: 'button', onclick: clear }, 'Clear');
  const ghost = el('input', { type: 'checkbox', id: 'ghost-toggle' });
  ghost.checked = true;

  const status = el('div', { className: 'build-note' }, 'Preparing the recognition index…');
  const candidates = el('div', { className: 'candidates' });

  mount.appendChild(el('div', { className: 'view-head' },
    el('h1', null, 'Draw to search'),
    el('p', null, 'Draw a character in the box and the closest matches appear as you go. The box is a practice grid — try to fill it the way you would on paper.')));

  mount.appendChild(el('div', { className: 'draw-layout' },
    el('div', null,
      el('div', { className: 'pad-wrap' }, pad),
      el('div', { className: 'pad-tools' }, undoBtn, clearBtn,
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--ink-soft)' } },
          ghost, 'Show ghost')),
      status),
    el('div', null,
      el('h2', { style: { margin: '0 0 4px', fontSize: '15px' } }, 'Closest matches'),
      el('p', { className: 'hint' }, 'Ranked by shape. Tap one to open it.'),
      candidates)));

  /* ---- optional ghost of a target character ---- */

  let ghostStage = null;

  if (ghostEntry) {
    ghostStage = el('div', { className: 'glyph-stage', style: { position: 'absolute', inset: '0', opacity: '0.16', pointerEvents: 'none', borderRadius: '10px' } });
    pad.parentElement.style.position = 'relative';
    pad.parentElement.appendChild(ghostStage);
    const [cp, kind, ...paths] = ghostEntry;
    void cp;
    if (kind === 0) kanjiGlyph(ghostStage, paths, { grid: false });
    else outlineGlyph(ghostStage, paths);
  }

  /* ---- drawing ---- */

  let strokes = [];
  let drawing = null;

  function paintGrid() {
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

    // Diagonals only appear while a ghost character is loaded; they help with
    // stroke balance for characters built on a cross.
    if (ghostStage) {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(PAD, PAD);
      ctx.moveTo(PAD, 0); ctx.lineTo(0, PAD);
      ctx.stroke();
    }

    ctx.strokeStyle = inkColour();
    ctx.lineWidth = Math.max(10, PAD * 0.055);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.01, s[0][1]);
      ctx.stroke();
    }
  }

  function pointOf(event) {
    const r = pad.getBoundingClientRect();
    return [
      ((event.clientX - r.left) / r.width) * PAD,
      ((event.clientY - r.top) / r.height) * PAD,
    ];
  }

  pad.addEventListener('pointerdown', (e) => {
    if (!ready) return;
    pad.setPointerCapture(e.pointerId);
    drawing = [pointOf(e)];
    strokes.push(drawing);
    paintGrid();
  });

  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.push(pointOf(e));
    paintGrid();
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = null;
    paintGrid();
    search();
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('pointerleave', endStroke);

  function undo() {
    strokes.pop();
    paintGrid();
    search();
  }

  function clear() {
    strokes = [];
    paintGrid();
    renderCandidates([]);
  }

  /* ---- recognition ---- */

  let worker = null;
  let ready = false;
  let pending = 0;
  let latestRequest = 0;

  const probe = el('canvas', { width: RES, height: RES });
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });

  async function start() {
    try {
      const strokesData = await data.loadStrokes();
      worker = new Worker(new URL('../recognizer.worker.js', import.meta.url), { type: 'module' });

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'error') {
          status.textContent = `Recognition unavailable: ${msg.message}`;
          return;
        }
        if (msg.type === 'progress') {
          status.innerHTML = `Building recognition index… <b>${Math.round(msg.value * 100)}%</b>`;
          const bar = el('div', { className: 'bar' }, el('span', { style: { width: `${msg.value * 100}%` } }));
          status.appendChild(bar);
        } else if (msg.type === 'ready') {
          ready = true;
          status.innerHTML = `Ready — ${msg.count} characters loaded. Draw in the box.`;
        } else if (msg.type === 'results' && msg.id === latestRequest) {
          renderCandidates(msg.results);
        }
      };

      worker.onerror = (e) => {
        status.textContent = `Recognition unavailable: ${e.message || 'worker failed to start'}`;
      };
      worker.postMessage({ type: 'init', strokes: strokesData });
    } catch (err) {
      status.textContent = `Recognition unavailable: ${err.message}. You can still browse by level.`;
    }
  }

  function search() {
    if (!ready || !strokes.length) { renderCandidates([]); return; }

    probeCtx.setTransform(1, 0, 0, 1, 0, 0);
    probeCtx.clearRect(0, 0, RES, RES);
    probeCtx.scale(RES / PAD, RES / PAD);
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

    const img = probeCtx.getImageData(0, 0, RES, RES);
    const id = ++latestRequest;
    worker.postMessage({
      type: 'search',
      id,
      bitmaps: packBitmap(img.data).buffer,
      hist: histogram(img.data).buffer,
      strokes: strokes.length,
      limit: 12,
    });
    pending = id;
    void pending;
  }

  function renderCandidates(results) {
    candidates.replaceChildren();
    if (!results.length) {
      candidates.appendChild(el('div', { className: 'empty', style: { gridColumn: '1 / -1' } },
        strokes.length ? 'No close match yet — keep going.' : 'Nothing drawn yet.'));
      return;
    }

    for (const r of results) {
      const ch = String.fromCodePoint(r.cp);
      const pct = Math.round(Math.max(0, Math.min(1, r.confidence)) * 100);
      const lv = (data.index.levelOf || {})[ch];
      candidates.appendChild(el('a', {
        className: 'candidate',
        href: hrefFor(ch),
        title: `Open ${ch}${lv ? ' (' + lv.toUpperCase() + ')' : ''}`,
      },
        el('span', { className: 'ch' }, ch),
        lv ? el('span', { className: 'lv' }, lv.toUpperCase()) : null,
        el('span', { className: 'conf' }, `${pct}%`)));
    }
  }

  /**
   * Candidates come from the flat stroke index, so a level has to be looked up
   * rather than searched for in a bundle that may not be loaded. index.json
   * carries a char -> level map for exactly this.
   */
  function hrefFor(ch) {
    const lv = (data.index.levelOf || {})[ch];
    if (lv) return `#/kanji/${lv}/${encodeURIComponent(ch)}`;
    if (/[\u3041-\u30ff]/.test(ch)) return `#/kana/${/\u30a1/.test(ch) ? 'kata' : 'hira'}/${encodeURIComponent(ch)}`;
    return '#/kanji';
  }

  ghost.addEventListener('change', () => {
    if (ghostStage) ghostStage.style.opacity = ghost.checked ? '0.16' : '0';
  });

  clear();
  start();

  // Repaint when the theme flips: the strokes already on the canvas were drawn
  // in the old ink colour, which is invisible on the other theme's pad.
  const themeWatch = new MutationObserver(() => paintGrid());
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return {
    destroy() {
      themeWatch.disconnect();
      if (worker) worker.terminate();
    },
  };
}