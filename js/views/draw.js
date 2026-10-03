// Draw to search.
//
// The pad is a 田字格 practice box, which is also exactly how kanji are drawn, so
// whatever the user draws maps straight onto the template frame the recognizer
// was built with. Recognition runs after every stroke, so the candidate list
// narrows as they write rather than only at the end.

import { el } from '../util.js';
import { data } from '../store.js';
import { createPad, rasterise } from '../pad.js';
import { RES, packBitmap, histogram } from '../recognizer.js';

export async function render(segs, mount) {
  await data.loadIndex();
  // A target character is drawn as a faint ghost behind the pad. Its geometry
  // comes from the same flat stroke index the recognizer uses, so showing a
  // ghost does not mean fetching a whole level bundle.
  const targetChar = segs[0] || null;
  const ghostEntry = targetChar
    ? (data.strokesIndex || await data.loadStrokes()).find((e) => e[0] === targetChar.codePointAt(0))
    : null;

  const status = el('div', { className: 'build-note' }, 'Preparing the recognition index…');
  const candidates = el('div', { className: 'candidates' });

  const undoBtn = el('button', { className: 'btn', type: 'button', onclick: () => pad.undo() }, 'Undo stroke');
  const clearBtn = el('button', { className: 'btn', type: 'button', onclick: () => pad.clear() }, 'Clear');
  const ghost = el('input', { type: 'checkbox', id: 'ghost-toggle' });
  ghost.checked = true;

  const pad = createPad({ onEnd: search, enabled: false });

  mount.appendChild(el('div', { className: 'view-head' },
    el('h1', null, 'Draw to search'),
    el('p', null, 'Draw a character in the box and the closest matches appear as you go. The box is a practice grid — try to fill it the way you would on paper.')));

  mount.appendChild(el('div', { className: 'draw-layout' },
    el('div', null,
      el('div', { className: 'pad-wrap' }, pad.canvas),
      el('div', { className: 'pad-tools' }, undoBtn, clearBtn,
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--ink-soft)' } },
          ghost, 'Show ghost')),
      status),
    el('div', null,
      el('h2', { style: { margin: '0 0 4px', fontSize: '15px' } }, 'Closest matches'),
      el('p', { className: 'hint' }, 'Ranked by shape. Tap one to open it.'),
      candidates)));

  if (ghostEntry) pad.setGhost(ghostEntry);

  ghost.addEventListener('change', () => pad.showGhost(ghost.checked));

  /* ---- recognition ---- */

  let worker = null;
  let ready = false;
  let latestRequest = 0;

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
          pad.enabled = true;
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

  function search(strokes) {
    if (!ready || !strokes.length) { renderCandidates([]); return; }

    const img = rasterise(strokes, RES);
    const id = ++latestRequest;
    worker.postMessage({
      type: 'search',
      id,
      bitmaps: packBitmap(img).buffer,
      hist: histogram(img).buffer,
      strokes: strokes.length,
      limit: 12,
    });
  }

  function renderCandidates(results) {
    candidates.replaceChildren();
    if (!results.length) {
      candidates.appendChild(el('div', { className: 'empty', style: { gridColumn: '1 / -1' } },
        pad.strokes.length ? 'No close match yet — keep going.' : 'Nothing drawn yet.'));
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

  start();

  return {
    destroy() {
      pad.destroy();
      if (worker) worker.terminate();
    },
  };
}