// Recognising a hand-drawn character from its stroke geometry.
//
// Approach
// --------
// KanjiVG and the kana set give us the character's real geometry, so instead of
// training a model we turn every character into a set of small bitmaps and
// compare the drawing against them directly:
//
//   1. Render each character -- and each *prefix* of its strokes -- into a
//      48x48 bitmap. Prefixes matter because people draw a kanji in order: after
//      two strokes, only a two-stroke template should match well.
//   2. Store those bitmaps packed into 32-bit words, so a comparison is 36 XORs
//      plus a popcount. Scoring every template then costs well under a frame.
//   3. Add an orientation histogram computed from the bitmap itself, which
//      separates shapes that overlap in silhouette but differ in stroke angle.
//
// Normalisation: templates use the character's own box (KanjiVG's 109-unit
// frame, the kana set's 1024-unit frame), and the drawing pad is that same box,
// drawn on a practice grid. That is how kanji are actually written, and it keeps
// the two sides directly comparable.

export const RES = 48;                 // template edge length in pixels
export const WORDS = (RES * RES) / 32; // packed 32-bit words per bitmap
export const HIST_BINS = 8;
const MAX_PREFIX = 4;                  // progressive templates stop here
const INK_THRESHOLD = 96;              // alpha above this counts as ink

/* ---- bitmap helpers ------------------------------------------------- */

export function packBitmap(alpha, res = RES) {
  const words = new Uint32Array((res * res) / 32);
  for (let i = 0; i < res * res; i++) {
    if (alpha[i * 4 + 3] >= INK_THRESHOLD) words[i >> 5] |= 1 << (i & 31);
  }
  return words;
}

export function popcount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >> 24);
}

/**
 * Unsigned stroke-orientation histogram, straight from the raster.
 * Reading direction is deliberately ignored: 一 drawn left-to-right and
 * right-to-left are the same character.
 */
export function histogram(alpha, res = RES) {
  const bins = new Float32Array(HIST_BINS);
  const at = (x, y) => alpha[((y * res) + x) * 4 + 3] / 255;

  for (let y = 1; y < res - 1; y++) {
    for (let x = 1; x < res - 1; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
               - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
               - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);

      const mag = Math.hypot(gx, gy);
      if (mag < 0.05) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(HIST_BINS - 1, Math.floor((angle / Math.PI) * HIST_BINS));
      bins[bin] += mag;
    }
  }

  let total = 0;
  for (let i = 0; i < HIST_BINS; i++) total += bins[i];
  if (total > 0) for (let i = 0; i < HIST_BINS; i++) bins[i] /= total;
  return bins;
}

/* ---- index construction ---------------------------------------------- */

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * @param strokes  the flat index from data/strokes.json:
 *                 [codepoint, kind, ...paths] where kind 0 is stroke
 *                 centre-lines (kanji) and 1 is a filled outline (kana).
 * @param onProgress  called with 0..1
 */
export async function buildIndex(strokes, onProgress = () => {}) {
  const canvas = makeCanvas(RES);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });

  const bitmaps = [];
  const hists = [];
  const ownerCp = [];
  const ownerStart = [0];
  const strokeCounts = [];

  const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

  for (let i = 0; i < strokes.length; i++) {
    const [cp, kind, ...paths] = strokes[i];
    const box = kind === 0 ? 109 : 1024;

    const paths2d = [];
    for (const d of paths) {
      try { paths2d.push(new Path2D(d)); } catch { /* malformed path */ }
    }
    if (!paths2d.length) { ownerStart.push(ownerCp.length); continue; }

    const counts = kind === 0
      ? prefixCounts(paths2d.length)
      : [range(paths2d.length)];   // filled outlines: whole character only

    const scale = RES / box;

    for (const group of counts) {
      const acc = kind === 0 ? new Path2D() : null;
      for (let k = 0; k < group.length; k++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, RES, RES);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        if (kind === 0) {
          acc.addPath(paths2d[k]);
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#fff';
          ctx.stroke(acc);
        } else {
          // group holds indices into paths2d, not the paths themselves:
          // filling an index throws and takes the whole index build down.
          ctx.fillStyle = '#fff';
          for (const i of group) ctx.fill(paths2d[i]);
        }

        const img = ctx.getImageData(0, 0, RES, RES);
        bitmaps.push(packBitmap(img.data));
        hists.push(histogram(img.data));
        ownerCp.push(cp);
      }
    }

    strokeCounts.push(paths2d.length);
    ownerStart.push(ownerCp.length);

    if ((i & 31) === 0) {
      onProgress((i + 1) / strokes.length);
      await yieldToUI();
    }
  }

  return {
    res: RES,
    words: WORDS,
    bitmaps: concatWords(bitmaps),
    hists: concatFloats(hists),
    ownerCp: Int32Array.from(ownerCp),
    ownerStart: Int32Array.from(ownerStart),
    strokeCounts: Int32Array.from(strokeCounts),
    count: strokes.length,
  };
}

/** Which stroke counts get their own template: 1,2,3,4 and the whole thing. */
function prefixCounts(n) {
  const out = [];
  for (let k = 1; k <= Math.min(n, MAX_PREFIX); k++) out.push(range(k));
  if (n > MAX_PREFIX) out.push(range(n));
  else if (!out.length) out.push(range(n));
  return out;
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

function concatWords(list) {
  const out = new Uint32Array(list.length * WORDS);
  for (let i = 0; i < list.length; i++) out.set(list[i], i * WORDS);
  return out;
}

function concatFloats(list) {
  const out = new Float32Array(list.length * HIST_BINS);
  for (let i = 0; i < list.length; i++) out.set(list[i], i * HIST_BINS);
  return out;
}

/* ---- matching -------------------------------------------------------- */

const BITMAP_WEIGHT = 0.72;
const HIST_WEIGHT = 0.28;
const TOP_N = 12;

/**
 * Score a drawing against every template and return the best candidates.
 * @param query  { bitmaps: Uint32Array(WORDS), hist: Float32Array(HIST_BINS), strokes: number }
 */
export function createMatcher(index) {
  const { bitmaps, hists, ownerCp, ownerStart, words } = index;
  const nChars = ownerStart.length - 1;

  return function match(query, limit = TOP_N) {
    const { bitmaps: qb, hist: qh, strokes: drawn } = query;

    let qInk = 0;
    for (let w = 0; w < words; w++) qInk += popcount(qb[w]);
    if (qInk === 0) return [];

    const best = new Array(nChars).fill(Infinity);

    for (let t = 0; t < ownerCp.length; t++) {
      const base = t * words;
      let xor = 0;
      let both = 0;
      for (let w = 0; w < words; w++) {
        const a = qb[w];
        const b = bitmaps[base + w];
        xor += popcount(a ^ b);
        both += popcount(a & b);
      }
      // |a union b| == xor + both. Deriving it as qInk + xor - both instead
      // divides a small error by a small number when the two bitmaps nearly
      // agree: a trace that is 96% correct came out as a 67% mismatch, because
      // the denominator collapsed towards zero just as the numerator did.
      const union = xor + both;

      // 1 - intersection-over-union, which stays sane when one side has far
      // more ink than the other.
      const shape = xor / Math.max(1, union);

      const hb = t * HIST_BINS;
      let histDiff = 0;
      for (let b = 0; b < HIST_BINS; b++) histDiff += Math.abs(qh[b] - hists[hb + b]);
      histDiff *= 0.5;

      // A drawing with three strokes should not be scored against a
      // twelve-stroke template as if it were a near miss.
      const charIdx = charOfTemplate(t, ownerStart);
      const gap = Math.abs(index.strokeCounts[charIdx] - drawn);

      const score = BITMAP_WEIGHT * shape + HIST_WEIGHT * histDiff + 0.018 * gap;
      if (score < best[charIdx]) best[charIdx] = score;
    }

    return best
      // best is indexed by character slot, so the codepoint has to come from
      // ownerCp -- returning the index itself shows up as a matching character.
      .map((score, slot) => ({ cp: ownerCp[ownerStart[slot]], score, confidence: Math.max(0, 1 - score / 1.35) }))
      .filter((r) => Number.isFinite(r.score) && r.cp)
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
  };
}

const charIndexCache = new WeakMap();
function charOfTemplate(t, ownerStart) {
  let cache = charIndexCache.get(ownerStart);
  if (!cache) { cache = new Map(); charIndexCache.set(ownerStart, cache); }
  let idx = cache.get(t);
  if (idx === undefined) {
    // ownerStart is ascending; find the character this template belongs to.
    let lo = 0;
    let hi = ownerStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ownerStart[mid] <= t) lo = mid; else hi = mid - 1;
    }
    idx = lo;
    cache.set(t, idx);
  }
  return idx;
}

/** Turn a canvas into the packed bitmap + histogram the matcher expects. */
export function queryFromCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, RES, RES);
  return { bitmaps: packBitmap(img.data), hist: histogram(img.data) };
}