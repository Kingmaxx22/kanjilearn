// Data loading and app-wide lookup.
//
// Bundles are fetched lazily: the index and kana are small and load immediately,
// each JLPT level loads when you open it, and the stroke index (used only by
// draw-to-search) loads on demand. Everything that is fetched is remembered.

import { store as local } from './util.js';

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
};

export const data = {
  index: null,
  kana: null,
  levels: new Map(),      // level id -> { level, kanji: [...] }
  strokesIndex: null,

  async loadIndex() {
    this.index ||= await json('data/index.json');
    return this.index;
  },

  async loadKana() {
    this.kana ||= await json('data/kana.json');
    return this.kana;
  },

  async loadLevel(id) {
    if (!this.levels.has(id)) this.levels.set(id, await json(`data/levels/${id}.json`));
    return this.levels.get(id);
  },

  async loadStrokes() {
    this.strokesIndex ||= await json('data/strokes.json');
    return this.strokesIndex;
  },

  /** Load every level, for search and flashcards. */
  async loadAllLevels() {
    await this.loadIndex();
    await Promise.all(this.index.levels.map((l) => this.loadLevel(l.id)));
    return this.allKanji();
  },

  allKanji() {
    const out = [];
    for (const bundle of this.levels.values()) out.push(...bundle.kanji);
    return out;
  },

  find(ch) {
    for (const bundle of this.levels.values()) {
      const hit = bundle.kanji.find((k) => k.c === ch);
      if (hit) return hit;
    }
    return null;
  },
};

export const LEVEL_LABEL = { n5: 'N5', n4: 'N4', n3: 'N3', n2: 'N2', n1: 'N1' };
export const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];

/* ---- study progress -------------------------------------------------- */

/**
 * A deliberately simple spaced schedule: "know it" backs the card off to a
 * longer gap, "again" brings it straight back. Enough to stop rereading the
 * same ten kanji forever without pretending to be a real SRS.
 */
const GAPS = [0, 1, 2, 4, 8, 21];  // days

export const progress = {
  get(ch) {
    return local.get('progress:' + ch, null);
  },

  all() {
    const map = local.get('progress', {});
    return map;
  },

  mark(ch, knewIt) {
    const map = this.all();
    const prev = map[ch] || { box: 0, seen: 0, last: 0 };
    const box = knewIt ? Math.min(GAPS.length - 1, prev.box + 1) : 0;
    map[ch] = { box, seen: (prev.seen || 0) + 1, last: Date.now() };
    local.set('progress', map);
    return map[ch];
  },

  isKnown(ch) {
    const p = this.get(ch);
    if (!p) return false;
    if (p.box < 2) return false;
    const due = p.last + GAPS[p.box] * 86400000;
    return Date.now() < due + 86400000;  // still fresh
  },

  isDue(ch) {
    const p = this.get(ch);
    if (!p) return true;
    return Date.now() >= p.last + GAPS[p.box] * 86400000;
  },

  stats() {
    const map = this.all();
    const keys = Object.keys(map);
    return {
      total: keys.length,
      known: keys.filter((k) => this.isKnown(k)).length,
      learning: keys.filter((k) => !this.isKnown(k)).length,
    };
  },

  reset() {
    local.set('progress', {});
  },
};

/* ---- traced characters ---------------------------------------------- */

/**
 * Separate from study progress: this records that a character has been traced
 * on the Learn pad, and the best match score reached doing it. Keeping it apart
 * means practising your handwriting never touches the spaced-repetition boxes.
 */
export const learned = {
  all() {
    return local.get('learned', {});
  },

  get(ch) {
    return this.all()[ch] || null;
  },

  has(ch) {
    return !!this.get(ch);
  },

  /** Called with a match percentage; only a better score replaces the old one. */
  mark(ch, pct) {
    const map = this.all();
    const prev = map[ch] || { best: 0, seen: 0 };
    map[ch] = { best: Math.max(prev.best || 0, pct), seen: (prev.seen || 0) + 1 };
    local.set('learned', map);
    return map[ch];
  },

  reset() {
    local.set('learned', {});
  },
};