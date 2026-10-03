/**
 * build-data.mjs
 *
 * Assembles the static JSON the app ships with. No npm dependencies.
 *
 *   cache/openjlpt/kanji/*.json   ->  JLPT N5-N1 membership + readings + meanings
 *   cache/kanjivg.xml.gz          ->  stroke order, one path per stroke
 *   cache/openjlpt/vocab/*.json   ->  levelled vocabulary + Tatoeba examples
 *   cache/jmdict-eng-common.json ->  fallback words for kanji JLPT does not cover
 *   cache/kanjidic2.xml.gz        ->  reading lists used to align furigana
 *   cache/strokesvg-main/dist/*   ->  kana stroke order (Klee One, OFL)
 *
 * Run:  node tools/build-data.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { parseKanjidic, parseKanjiVG, readKanaSvgs, readGz, CJK_RE } from './lib/sources.mjs';
import { makeAligner } from './lib/align.mjs';
import { mineReadings, mineFromAligned, mergeReadings } from './lib/readings.mjs';
import { expandedReadings, isSokuonReading } from './lib/kana.mjs';
import { HIRAGANA, KATAKANA, DERIVED, SMALL } from './kana-source.mjs';

const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const arr = (d) => (Array.isArray(d) ? d : d.kanji || d.vocab || Object.values(d));

const t0 = Date.now();
const log = (msg) => console.log(`${String((Date.now() - t0) / 1000).padStart(6)}s  ${msg}`);

/* ---- inputs --------------------------------------------------------- */

const kanjiDict = parseKanjidic(readGz('cache/kanjidic2.xml.gz'));
const strokesByCp = parseKanjiVG(readGz('cache/kanjivg.xml.gz'));
log(`KANJIDIC2 ${kanjiDict.size} chars, KanjiVG ${strokesByCp.size} drawings`);

const vocabByLevel = {};
const kanjiByLevel = {};
for (const lv of LEVELS) {
  vocabByLevel[lv] = arr(load(`cache/openjlpt/vocab/${lv}.json`));
  kanjiByLevel[lv] = arr(load(`cache/openjlpt/kanji/${lv}.json`));
}
const allVocab = LEVELS.flatMap((l) => vocabByLevel[l]);
log(`OpenJLPT ${allVocab.length} vocabulary, ${LEVELS.reduce((n, l) => n + kanjiByLevel[l].length, 0)} kanji`);

/* ---- readings + aligner --------------------------------------------- */

// Readings recovered from example-sentence furigana steer the alignment only;
// see tools/lib/readings.mjs for why they are not shown in the app.
//
// Two passes: the marker pass needs no aligner (Tatoeba marks single kanji
// directly), and its output then lets the aligner run over whole vocabulary
// words to recover readings that markers group together, like に for 日 in 日本.
const markers = mineReadings(allVocab, { minCount: 1 });
const probe = makeAligner(kanjiDict, markers);
const mined = mergeReadings(markers, mineFromAligned(allVocab, probe, { minCount: 2 }));
log(`mined ${mined.size} kanji worth of supplementary readings`);

const align = makeAligner(kanjiDict, mined);

// What a word is allowed to say this kanji is read as: any listed reading
// (katakana or hiragana, stem or full), plus anything recovered from examples.
const matchable = new Map();
const readingsFor = (ch) => {
  let m = matchable.get(ch);
  if (!m) {
    const e = kanjiDict.get(ch);
    m = e ? expandedReadings(e.on, e.kun) : new Set();
    matchable.set(ch, m);
  }
  return m;
};

const minedReadingsOf = (ch) => mined.get(ch) || new Map();
// A sokuon is never a kanji's reading, so it is never an acceptable match.
const acceptable = (ch, kana) =>
  !isSokuonReading(kana) && (readingsFor(ch).has(kana) || minedReadingsOf(ch).has(kana));

/* ---- vocabulary pool ------------------------------------------------ */

// Primary pool: OpenJLPT vocabulary, which already carries a JLPT level we can
// rank by. `levelNum` 1..5 is N5..N1.
const pool = [];
const seenPair = new Set();

const glossOf = (meanings) => {
  const t = (meanings || [])[0];
  return t ? String(t).replace(/\s+/g, ' ').replace(/^\(.*?\)\s*/, '').trim().slice(0, 70) : '';
};

for (const lv of LEVELS) {
  const levelNum = LEVELS.indexOf(lv) + 1;
  for (const v of vocabByLevel[lv]) {
    const w = v.word;
    if (!w || w.length > 8) continue;
    if (![...w].some((ch) => CJK_RE.test(ch))) continue;
    const g = glossOf(v.meanings);
    if (!g) continue;

    const res = align(w, v.reading);
    if (!res || !res.complete) continue;

    const key = w + '\u0000' + v.reading;
    if (seenPair.has(key)) continue;
    seenPair.add(key);

    let cost = (levelNum - 1) * 3 + w.length * 1.5;
    cost += Math.abs([...v.reading].length - [...w].length) * 0.4;
    cost += (1 - res.knownRatio) * 8;

    pool.push({ w, r: v.reading, a: res.perChar, g, cost, src: 'jlpt', lv });
  }
}

// Fallback: JMdict common entries, for the kanji that no JLPT word happens to
// use (550 of them). Heuristically ranked, and only consulted per kanji when
// the JLPT pool came up empty.
const jmdict = load('cache/jmdict-eng-common-3.6.2.json');
const jmWords = [];
for (const entry of jmdict.words) {
  const kanjiEls = (entry.kanji || []).filter((e) => e.common !== false);
  const kanaEls = (entry.kana || []).filter((e) => e.common !== false);
  if (!kanjiEls.length || !kanaEls.length) continue;

  let g = '';
  for (const sense of entry.sense || []) {
    const gl = (sense.gloss || []).find((x) => x.lang === 'eng' && x.text);
    if (gl) { g = String(gl.text).replace(/\s+/g, ' ').replace(/^\(.*?\)\s*/, '').trim().slice(0, 70); break; }
  }
  if (!g) continue;

  for (const kEl of kanjiEls) {
    const w = kEl.text;
    if (!w || w.length > 6) continue;
    const tagged = kanaEls.find((e) => (e.appliesToKanji || []).includes(w));
    const reading = tagged ? tagged.text : (kanaEls[0] && kanaEls[0].text);
    if (!reading || reading.length > 12) continue;

    const res = align(w, reading);
    if (!res || !res.complete) continue;

    const key = w + '\u0000' + reading;
    if (seenPair.has(key)) continue;
    seenPair.add(key);

    let cost = 12 + w.length * 2;
    for (const ch of w) {
      const e = kanjiDict.get(ch);
      const lvl = e && e.freq ? Math.min(5, e.freq / 900) : 3;
      cost += lvl;
    }
    cost += (1 - res.knownRatio) * 8;
    jmWords.push({ w, r: reading, a: res.perChar, g, cost, src: 'jmdict', lv: null });
  }
}
log(`word pool: ${pool.length} JLPT + ${jmWords.length} JMdict fallback`);

const jmByKanji = new Map();
for (const word of jmWords) {
  const chars = [...word.w];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const rd = word.a[i];
    if (!rd || !acceptable(ch, rd)) continue;
    const list = jmByKanji.get(ch) || [];
    if (list.length < 60) list.push({ ...word, k: i, rd });
    jmByKanji.set(ch, list);
  }
}

/* ---- per-kanji assembly ---------------------------------------------- */

const sentencesByKanji = new Map();
for (const lv of LEVELS) {
  for (const v of vocabByLevel[lv]) {
    for (const ex of v.examples || []) {
      if (!ex.ja || !ex.en) continue;
      if (ex.furigana && /#\d/.test(ex.furigana)) continue; // Tatoeba placeholder
      for (const ch of new Set(v.word.split(''))) {
        if (!CJK_RE.test(ch)) continue;
        // The sentence has to actually contain the character, otherwise the
        // example is about a different word that happens to share an entry.
        if (!ex.ja.includes(ch)) continue;
        const list = sentencesByKanji.get(ch) || [];
        if (list.length < 2 && !list.some((s) => s.ja === ex.ja)) list.push({ ja: ex.ja, fu: ex.furigana || null, en: ex.en });
        sentencesByKanji.set(ch, list);
      }
    }
  }
}

const records = [];
const skippedNoStrokes = [];

for (const lv of LEVELS) {
  const levelNum = LEVELS.indexOf(lv) + 1;
  for (const entry of kanjiByLevel[lv]) {
    const dictEntry = kanjiDict.get(entry.character);
    if (!dictEntry) continue;

    const strokes = dictEntry.cp ? strokesByCp.get(dictEntry.cp) : null;
    if (!strokes) { skippedNoStrokes.push(entry.character); continue; }

    const cands = [];
    for (const word of pool) {
      const chars = [...word.w];
      const idx = chars.indexOf(entry.character);
      if (idx < 0) continue;
      const rd = word.a[idx];
      if (!rd || !acceptable(entry.character, rd)) continue;
      cands.push({ ...word, k: idx, rd });
    }
    if (cands.length < 3) {
      for (const word of jmByKanji.get(entry.character) || []) {
        const chars = [...word.w];
        if (chars.indexOf(entry.character) < 0) continue;
        cands.push(word);
      }
    }
    cands.sort((a, b) => a.cost - b.cost);

    // Tally how often each reading shows up in real words: "you mostly meet
    // this kanji read に" is far more useful than a flat list of readings.
    const counts = new Map();
    for (const c of cands) counts.set(c.rd, (counts.get(c.rd) || 0) + 1);
    const tally = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);

    // Cover every reading first so rare ones are not crowded out, then fill the
    // rest with the most generally useful words.
    const chosen = [];
    const used = new Map();
    const seen = new Set();
    for (const c of cands) {
      const n = used.get(c.rd) || 0;
      if (n >= 2) continue;
      used.set(c.rd, n + 1);
      const key = c.w + '\u0000' + c.r;
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(c);
      if (chosen.length >= 10) break;
    }
    for (const c of cands) {
      if (chosen.length >= 10) break;
      const key = c.w + '\u0000' + c.r;
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(c);
    }

    const kun = entry.kunyomi && entry.kunyomi.length ? entry.kunyomi : dictEntry.kun;
    const on = entry.onyomi && entry.onyomi.length ? entry.onyomi : dictEntry.on;

    records.push({
      c: entry.character,
      cp: dictEntry.cp,
      lv,
      s: strokes,
      n: dictEntry.strokes ?? strokes.length,
      g: dictEntry.grade,
      f: dictEntry.freq,
      rad: entry.radical ?? null,
      radn: entry.radical_number ?? null,
      on,
      kun,
      mean: entry.meanings && entry.meanings.length ? entry.meanings : dictEntry.mean,
      mc: tally.length ? tally[0][0] : kun[0] || on[0] || null,
      rc: tally.map(([r, c]) => `${r}:${c}`).join(','),
      w: chosen.map((c) => [c.w, c.r, c.a.join(' '), c.g, c.k]),
      ex: (sentencesByKanji.get(entry.character) || []).map((s) => [s.ja, s.fu, s.en]),
    });
  }
}

log(`assembled ${records.length} kanji records${skippedNoStrokes.length ? ` (${skippedNoStrokes.length} skipped, no stroke data)` : ''}`);

/* ---- kana ------------------------------------------------------------ */

const hiraSvg = readKanaSvgs('cache/strokesvg-main/dist/hiragana');
const kataSvg = readKanaSvgs('cache/strokesvg-main/dist/katakana');

const romaji = new Map();
const mnemonic = new Map();
for (const t of [...HIRAGANA, ...KATAKANA]) { romaji.set(t.c, t.r); mnemonic.set(t.c, t.m); }
const derivedFrom = new Map();
for (const d of DERIVED) { romaji.set(d.c, d.r); derivedFrom.set(d.c, d.base); }
for (const s of SMALL) derivedFrom.set(s.c, s.base);

const isHiraganaChar = (c) => c >= '\u3041' && c <= '\u3096';
const isKatakanaChar = (c) => c >= '\u30a1' && c <= '\u30f6';

// Kana examples do not need per-character alignment -- we only show the word
// and its reading -- so they come straight from the vocabulary list. That also
// picks up pure katakana loanwords like ガス and パン, which the kanji-oriented
// pool above skips because they contain no kanji to align.
const wordsByKana = new Map();
for (const lv of LEVELS) {
  const levelNum = LEVELS.indexOf(lv) + 1;
  for (const v of vocabByLevel[lv]) {
    if (!v.reading || v.reading.length > 10 || !v.word || v.word.length > 8) continue;
    const g = glossOf(v.meanings);
    if (!g) continue;
    const cost = (levelNum - 1) * 3 + v.word.length * 0.5;
    for (const ch of new Set(v.reading)) {
      if (!isHiraganaChar(ch) && !isKatakanaChar(ch)) continue;
      const list = wordsByKana.get(ch) || [];
      if (list.length < 40) list.push({ w: v.word, r: v.reading, g, cost });
      wordsByKana.set(ch, list);
    }
  }
}

// Filled outlines, for recognising hand-drawn kana. Stroke centre-lines are not
// reliable here because the font's strokes carry clip paths.
const filledOutline = (svg) => {
  const g = svg.match(/<g data-strokesvg="shadows"[^>]*>([\s\S]*?)<\/g>\s*<g data-strokesvg="strokes"/);
  const body = g ? g[1] : svg;
  return [...body.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
};

const buildKana = (chars, svgs) => chars.map((ch) => {
  const base = derivedFrom.get(ch);
  const s = svgs.get(ch);
  const item = {
    c: ch,
    r: romaji.get(ch) || (base ? romaji.get(base) || null : null),
    m: mnemonic.get(ch) || (base ? mnemonic.get(base) || null : null),
    base: base || null,
    n: s ? s.strokes : 0,
  };
  if (s) item.svg = s.svg;
  if (base) {
    if (item.m && !mnemonic.has(ch)) item.m += item.base.length === 1 && isKatakanaChar(ch) ? '' : ' +dakuten';
    if (/[\u3041-\u3096]/.test(ch) && !isHiraganaChar(ch)) item.m = null; // small kana
    if (!/\u30fc/.test(ch) && /[\u30a1-\u30f6]/.test(ch) && !isKatakanaChar(ch)) item.m = null;
  }
  const outline = s ? filledOutline(s.svg) : [];
  if (outline.length) item.fill = outline;

  // For あ, the words that teach the vowel are あさ and あなた, not 青 or 赤:
  // prefer words starting on this kana and not running straight into another
  // vowel, which would turn it into a diphthong.
  const VOWELS = '\u3042\u3044\u3046\u3048\u304a\u30a2\u30a4\u30a6\u30a8\u30aa';
  const ranked = (wordsByKana.get(ch) || [])
    .map((w) => {
      const at = w.r.indexOf(ch);
      const next = w.r[at + 1] || '';
      // Words spelled with this kana (あなた, すぐ) teach it better than words
      // that only happen to be read with it (赤 for あ).
      const spelled = w.w.includes(ch) ? 0 : 1.5;
      const penalty = spelled + (at === 0 ? 0 : 2) + (VOWELS.includes(next) ? 3 : 0);
      return { w, s: w.cost + penalty };
    })
    .sort((a, b) => a.s - b.s);
  item.ex = ranked.slice(0, 3).map((x) => [x.w.w, x.w.r, x.w.g]);
  return item;
});

const hiraSet = new Set([...HIRAGANA.map((t) => t.c), ...DERIVED.map((d) => d.c), ...SMALL.map((s) => s.c)].filter(isHiraganaChar));
const kataSet = new Set([...KATAKANA.map((t) => t.c), ...DERIVED.map((d) => d.c), ...SMALL.map((s) => s.c)].filter(isKatakanaChar));

const kana = {
  hiragana: buildKana([...hiraSet], hiraSvg),
  katakana: buildKana([...kataSet], kataSvg),
};

// Teach in gojuon order (a i u e o ...) rather than code point order.
const GOJUON_H = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const GOJUON_K = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const sorter = (order) => (a, b) => {
  const rank = (c) => {
    const i = order.indexOf(c);
    if (i >= 0) return i;
    const base = derivedFrom.get(c);
    return base ? 100 + order.indexOf(base) : 900;
  };
  return rank(a.c) - rank(b.c) || (a.c < b.c ? -1 : 1);
};
kana.hiragana.sort(sorter(GOJUON_H));
kana.katakana.sort(sorter(GOJUON_K));

/* ---- write ----------------------------------------------------------- */

rmSync('data', { recursive: true, force: true });
mkdirSync('data/levels', { recursive: true });

let bytes = 0;
const levelMeta = [];

for (const lv of LEVELS) {
  const list = records.filter((r) => r.lv === lv);
  // School grade, then how common the kanji is, then stroke count: a sane order
  // to work through them in.
  list.sort((a, b) => (a.g ?? 9) - (b.g ?? 9) || (a.f ?? 99999) - (b.f ?? 99999) || a.n - b.n);

  const payload = list.map((r) => ({
    c: r.c, cp: r.cp, lv: r.lv, s: r.s, n: r.n, g: r.g, f: r.f, rad: r.rad, radn: r.radn,
    on: r.on, kun: r.kun, mn: r.mean, mc: r.mc, rc: r.rc, w: r.w, ex: r.ex,
  }));

  const json = JSON.stringify({ level: lv, kanji: payload });
  writeFileSync(`data/levels/${lv}.json`, json);
  // Buffer.byteLength, not json.length: the payloads are mostly non-ASCII, and
  // a string length in UTF-16 code units under-reports the file by ~8%.
  const size = Buffer.byteLength(json, 'utf8');
  bytes += size;
  levelMeta.push({ id: lv, label: lv.toUpperCase(), count: payload.length, kb: Math.round(size / 1024) });
  log(`${lv}: ${payload.length} kanji, ${(size / 1024).toFixed(0)} KB`);
}

const kanaJson = JSON.stringify(kana);
writeFileSync('data/kana.json', kanaJson);
bytes += Buffer.byteLength(kanaJson, 'utf8');
log(`kana: ${kana.hiragana.length + kana.katakana.length} characters, ${(Buffer.byteLength(kanaJson, 'utf8') / 1024).toFixed(0)} KB`);

// Flat stroke index for draw-to-search, so recognising a drawing does not
// require loading every level. [codepoint, kind, ...paths]
//   kind 0 = stroke centre-lines (progressive matching works)
//   kind 1 = filled outlines (kana, where the centre-lines are clipped)
const search = [];
for (const r of records) search.push([r.cp, 0, ...r.s]);
for (const group of [kana.hiragana, kana.katakana]) {
  for (const k of group) if (k.fill) search.push([k.c.codePointAt(0), 1, ...k.fill]);
}
const searchJson = JSON.stringify(search);
writeFileSync('data/strokes.json', searchJson);
bytes += Buffer.byteLength(searchJson, 'utf8');
log(`draw-search index: ${search.length} characters, ${(Buffer.byteLength(searchJson, 'utf8') / 1024 / 1024).toFixed(2)} MB`);

const index = {
  built: new Date().toISOString().slice(0, 10),
  total: records.length,
  levels: levelMeta,
  // char -> level, so views that only hold the flat stroke index (draw-to-search)
  // can still link a match to its detail page without loading every level.
  levelOf: Object.fromEntries(records.map((r) => [r.c, r.lv])),
  kana: { hiragana: kana.hiragana.length, katakana: kana.katakana.length },
  mb: +(bytes / 1024 / 1024).toFixed(2),
  sources: [
    { name: 'OpenJLPT', by: 'evanclan', use: 'JLPT N5-N1 membership, readings, meanings, levelled vocabulary and Tatoeba examples', licence: 'CC BY-SA 4.0' },
    { name: 'KANJIDIC2', by: 'EDRDG', use: 'reading lists used to align furigana, stroke counts, grade, frequency', licence: 'CC BY-SA 4.0 / CC BY-SA 3.0' },
    { name: 'KanjiVG', by: 'Ulrich Apel', use: 'stroke order', licence: 'CC BY-SA 3.0' },
    { name: 'JMdict', by: 'EDRDG', use: 'fallback vocabulary for kanji no JLPT word uses', licence: 'CC BY-SA 4.0 / GFDL' },
    { name: 'strokesvg', by: 'zhengkyl, from the Klee One font', use: 'kana stroke order', licence: 'SIL OFL 1.1' },
  ],
};
writeFileSync('data/index.json', JSON.stringify(index, null, 2));

log(`total ${(bytes / 1024 / 1024).toFixed(2)} MB across ${LEVELS.length + 3} files`);