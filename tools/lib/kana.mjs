// Kana helpers.

/** カタカナ -> ひらがな, so on'yomi can be matched against hiragana text. */
export const toHiragana = (s) =>
  s.replace(/[\u30a1-\u30f6]/g, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x30f4) return '\u3094'; // ヴ -> ゔ
    if (cp === 0x30f5) return '\u3095'; // ヵ -> ゕ
    if (cp === 0x30f6) return '\u3096'; // ヶ -> ゖ
    return String.fromCodePoint(cp - 0x60);
  });

const stripPrefixMark = (s) => s.replace(/^-/, '');

// The sokuon only ever doubles the consonant that follows it, so it is never the
// start of a kanji's reading. 日記 is にっき: 日 is に and 記 is っき, and letting
// the alignment hand the っ to 日 produces nonsense examples.
const SOKUON = /^[\u3063\u30c3]/;

export const isSokuonReading = (s) => SOKUON.test(s);

/**
 * Every kana string this kanji could legitimately be read with.
 *
 * Two things matter here:
 *
 *  - On'yomi are stored in katakana but turn up as hiragana in real text. 日 is
 *    ニチ in the dictionary and に in 日本, and refusing that match loses the
 *    single most useful example word for the character.
 *
 *  - Kun'yomi in KANJIDIC2 are written た.べる: everything before the dot is an
 *    alternative stem, and the whole thing is the reading with okurigana. We
 *    want はな, はな.せる and はなせる all matchable.
 */
export function expandedReadings(on = [], kun = []) {
  const out = new Set();
  const add = (r) => {
    const s = stripPrefixMark(r);
    if (!s) return;
    out.add(s);
    const h = toHiragana(s);
    if (h !== s) out.add(h);
  };
  for (const r of on) add(r);
  for (const r of kun) {
    add(r);
    if (r.includes('.')) {
      const parts = r.split('.');
      for (const p of parts) add(p);
      add(parts.join(''));
    }
  }
  return out;
}