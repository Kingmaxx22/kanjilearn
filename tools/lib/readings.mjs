// Mining supplementary kanji readings from Tatoeba furigana.
//
// KANJIDIC2 does not list every reading a kanji is actually used with. 茶 has no
// kun'yomi at all in KANJIDIC2, 父 is listed only as ちち but is read とう in
// お父さん, 姉 is listed as あね but is read ねえ in お姉さん. Without those, the
// aligner has nothing to aim at and guesses wrong.
//
// OpenJLPT's example sentences carry Tatoeba furigana in {kanji|reading} form,
// so we can recover those readings directly. They are used ONLY to steer
// alignment -- the reading lists shown in the app still come from KANJIDIC2,
// because "what are the readings of 父" should have one authoritative answer.

import { CJK_RE } from './sources.mjs';

/** Pull {kanji|reading} pairs out of a Tatoeba furigana string. */
export function furiganaPairs(furigana) {
  const out = [];
  for (const m of furigana.matchAll(/\{([^}|]+)\|([^}]+)\}/g)) {
    if (m[1].length === 1 && CJK_RE.test(m[1])) out.push([m[1], m[2]]);
  }
  return out;
}

/**
 * @param vocabEntries  OpenJLPT vocab entries (only .examples[].furigana is used)
 * @param opts.minCount  require a reading to appear this many times before we
 *                       trust it, so one oddball sentence cannot invent a reading
 * @returns Map<char, Map<reading, count>>
 */
export function mineReadings(vocabEntries, { minCount = 1 } = {}) {
  const raw = new Map();
  for (const v of vocabEntries) {
    for (const ex of v.examples || []) {
      if (!ex.furigana) continue;
      for (const [ch, reading] of furiganaPairs(ex.furigana)) {
        let m = raw.get(ch);
        if (!m) { m = new Map(); raw.set(ch, m); }
        m.set(reading, (m.get(reading) || 0) + 1);
      }
    }
  }

  const out = new Map();
  for (const [ch, counts] of raw) {
    const kept = new Map([...counts].filter(([, c]) => c >= minCount));
    if (kept.size) out.set(ch, kept);
  }
  return out;
}

/**
 * A second, noisier source: run the aligner over vocabulary entries and count
 * what it thinks each kanji is read as.
 *
 * This exists because Tatoeba writes multi-kanji words as one unit -- 日本 comes
 * through as {日本|にほん}, so the per-kanji reading に never shows up in the
 * marker pass, and KANJIDIC2 does not list it either (it has ニチ, not ニ). Left
 * alone, the strict reading filter then throws away 日本 for 日, which is a bad
 * loss: it is the most useful example word the character has.
 *
 * Treat the result as weaker evidence and keep a higher minCount.
 */
export function mineFromAligned(vocabEntries, aligner, { minCount = 2 } = {}) {
  const raw = new Map();
  for (const v of vocabEntries) {
    const res = aligner(v.word, v.reading);
    if (!res || !res.complete) continue;
    const chars = [...v.word];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (!CJK_RE.test(ch)) continue;
      const rd = res.perChar[i];
      if (!rd) continue;
      const m = raw.get(ch) || new Map();
      raw.set(ch, m);
      m.set(rd, (m.get(rd) || 0) + 1);
    }
  }

  const out = new Map();
  for (const [ch, counts] of raw) {
    const kept = new Map([...counts].filter(([, c]) => c >= minCount));
    if (kept.size) out.set(ch, kept);
  }
  return out;
}

/** Merge two mined reading maps, keeping the highest count per reading. */
export function mergeReadings(a, b) {
  const out = new Map(a);
  for (const [ch, counts] of b) {
    const existing = out.get(ch) || new Map();
    const merged = new Map(existing);
    for (const [r, c] of counts) merged.set(r, Math.max(merged.get(r) || 0, c));
    out.set(ch, merged);
  }
  return out;
}