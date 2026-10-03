// Recovering which kana belongs to which character.
//
// Given a written word and its full reading (日本 / にほんご) we need the
// per-character split (に / ほん / ご) so the app can render proper furigana and
// so we can say "this kanji is read に in this word". JMdict does not store that
// alignment, so we recover it with a small DP that leans on the reading lists in
// KANJIDIC2: a chunk of kana that is a known reading of the character is almost
// certainly the right chunk, which lets us resolve okurigana without any
// hand-written per-word rules.

import { KANA_RE, CJK_RE } from './sources.mjs';
import { expandedReadings, isSokuonReading } from './kana.mjs';

const KNOWN = 5;   // chunk is a listed reading of this kanji
const MINED = 4.6; // ...or one recovered from example-sentence furigana
const LEN_OK = 1;  // right kana length, but not a listed reading
const MINED_LEN = 0.8;
const WRONG = -1.5;
const SOKUON = -3;  // chunk starts with っ, so it belongs to the next kanji
const NONE = -4;   // kanji given no kana at all
const SKIP = 0.2;  // one kana character consumed as okurigana
const MAX_READING = 4; // longest reading we will consider (ん, 見, 茶 alike)

export function makeAligner(kanjiDict, mined = new Map()) {
  const cache = new Map();
  const readingsOf = (ch) => {
    let r = cache.get(ch);
    if (!r) {
      const e = kanjiDict.get(ch);
      const list = e ? [...expandedReadings(e.on, e.kun)] : [];
      const extra = mined.get(ch);
      r = {
        set: new Set(list),
        lengths: new Set(list.map((x) => x.length)),
        mined: extra || new Map(),
        minedLengths: new Set([...(extra || new Map()).keys()].map((x) => x.length)),
      };
      cache.set(ch, r);
    }
    return r;
  };

  /** Longest reading (listed, or mined) that `chunk` begins with. */
  const longestPrefix = (readings, chunk) => {
    for (let L = chunk.length; L > 0; L--) {
      if (readings.set.has(chunk.slice(0, L))) return L;
    }
    for (let L = chunk.length; L > 0; L--) {
      if (readings.mined.has(chunk.slice(0, L))) return L;
    }
    return 0;
  };

  return function align(kanjiStr, kanaStr) {
    const n = kanjiStr.length;
    const m = kanaStr.length;
    const NEG = -1e9;
    // back[i][j] packs the previous j in the high bits and the op in the low.
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG));
    const back = Array.from({ length: n + 1 }, () => new Int32Array(m + 1).fill(-1));
    dp[0][0] = 0;

    const relax = (i, j, val, prevJ, op) => {
      if (val > dp[i][j]) {
        dp[i][j] = val;
        back[i][j] = (prevJ << 8) | op;
      }
    };

    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        const cur = dp[i][j];
        if (cur === NEG) continue;

        if (i < n) {
          const ch = kanjiStr[i];
          if (KANA_RE.test(ch)) {
            // Kana written literally inside the word, e.g. き in とき.
            const target = kanaStr[j];
            const s = target === ch ? 4 : target && KANA_RE.test(target) ? 0.5 : -2;
            relax(i + 1, j + 1, cur + s, j, 1);
          } else if (!CJK_RE.test(ch)) {
            // Punctuation, digits, latin: nothing to align on the kana side.
            relax(i + 1, j, cur + 1, j, 2);
          } else {
            const readings = readingsOf(ch);
            const maxL = Math.min(MAX_READING, m - j);
            for (let L = 0; L <= maxL; L++) {
              const chunk = kanaStr.slice(j, j + L);
              let s;
              if (L === 0) {
                s = NONE;
              } else {
                // Prefer the longest reading this chunk starts with: 明 can be
                // あ / あき / あか / あかる, and in 明るい we want the あか stem
                // rather than the bare あ.
                const prefix = longestPrefix(readings, chunk);
                let base;
                if (isSokuonReading(chunk)) base = SOKUON;
                else if (readings.set.has(chunk)) base = KNOWN;
                else if (readings.mined.has(chunk)) base = MINED;
                else if (readings.lengths.has(L)) base = LEN_OK;
                else if (readings.minedLengths.has(L)) base = MINED_LEN;
                else base = WRONG;
                s = base + 0.25 * prefix;
              }
              relax(i + 1, j + L, cur + s, j, 3 + L);
            }
          }
        }

        if (j < m) relax(i, j + 1, cur + SKIP, j, 0); // okurigana
      }
    }

    if (dp[n][m] === NEG) return null;

    const perChar = new Array(n).fill('');
    const known = new Array(n).fill(false);
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      const packed = back[i][j];
      if (packed < 0) return null;
      const op = packed & 0xff;
      const prevJ = packed >> 8;

      if (op === 0) {
        // Okurigana: this step only moved along the kana, so i stays put.
        j = prevJ;
        continue;
      }

      if (op >= 3) {
        const L = op - 3;
        const ch = kanjiStr[i - 1];
        const chunk = kanaStr.slice(prevJ, prevJ + L);
        perChar[i - 1] = chunk;
        known[i - 1] = L > 0 && readingsOf(ch).set.has(chunk);
      }
      i--;
      j = prevJ;
      if (i < 0 || j < 0) return null;
    }

    const cjk = [];
    for (let k = 0; k < n; k++) if (CJK_RE.test(kanjiStr[k])) cjk.push(k);
    if (!cjk.length) return null;

    // Mined readings count for half: they are real, but a single example is
    // weaker evidence than KANJIDIC2.
    let credit = 0;
    for (const k of cjk) {
      if (known[k]) credit += 1;
      else {
        const ch = kanjiStr[k];
        const rd = perChar[k];
        if (rd && readingsOf(ch).mined.has(rd)) credit += 0.5;
      }
    }

    return {
      perChar,
      known,
      knownRatio: credit / cjk.length,
      // Every kana character accounted for by exactly one character of the word.
      complete: perChar.every((x) => x.length > 0),
      score: dp[n][m],
    };
  };
}