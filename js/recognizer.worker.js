// Recognition worker.
//
// Building the template index means rendering a few thousand characters into
// bitmaps, which takes seconds. Doing that on the main thread would freeze the
// page, so it runs here and the UI stays live and shows progress.

import { buildIndex, createMatcher, RES, WORDS, HIST_BINS } from './recognizer.js';

let index = null;
let match = null;

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      index = await buildIndex(msg.strokes, (p) => {
        self.postMessage({ type: 'progress', value: p });
      });
      match = createMatcher(index);
      self.postMessage({ type: 'ready', count: msg.strokes.length, res: RES });
    } catch (err) {
      // Without this the view would sit on "Building…" forever: an exception
      // here rejects the handler and nothing is ever posted back.
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
    return;
  }

  if (msg.type === 'search') {
    if (!match) return;
    const query = {
      bitmaps: new Uint32Array(msg.bitmaps),
      hist: new Float32Array(msg.hist),
      strokes: msg.strokes,
    };
    const results = match(query, msg.limit || 12);
    self.postMessage({ type: 'results', id: msg.id, results });
  }
};

self.postMessage({ type: 'hello', res: RES, words: WORDS, bins: HIST_BINS });