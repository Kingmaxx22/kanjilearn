/**
 * verify.mjs - data quality checks.
 *
 *   node tools/verify.mjs
 *
 * The interesting check is alignment. OpenJLPT's example sentences carry Tatoeba
 * furigana in {kanji|reading} form, which is ground truth for exactly the problem
 * tools/lib/align.mjs solves.
 *
 * Two numbers are reported, because a naive check would be circular:
 *
 *   baseline  align using only KANJIDIC2's reading lists, measured against every
 *             example sentence. Honest, but capped -- KANJIDIC2 does not list
 *             readings like とう for 父, so some sentences have no anchor.
 *
 *   held out  mined readings are learned from N5-N3 examples only and then
 *             scored on N2-N1 examples, which were never seen. This is the
 *             number that says whether mining generalises.
 */

import { readFileSync } from 'node:fs';
import { parseKanjidic, parseKanjiVG, readGz, CJK_RE } from './lib/sources.mjs';
import { makeAligner } from './lib/align.mjs';
import { mineReadings } from './lib/readings.mjs';

const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const arr = (d) => (Array.isArray(d) ? d : d.kanji || d.vocab || Object.values(d));

const kanjiDict = parseKanjidic(readGz('cache/kanjidic2.xml.gz'));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

/* ---- 1. level lists ------------------------------------------------- */

const levelOf = new Map();
const byLevel = {};
const vocabByLevel = {};
for (const lv of LEVELS) {
  const entries = arr(load(`cache/openjlpt/kanji/${lv}.json`));
  byLevel[lv] = new Map(entries.map((e) => [e.character, e]));
  for (const e of entries) {
    if (levelOf.has(e.character)) {
      console.log(`      note: ${e.character} appears in both ${levelOf.get(e.character)} and ${lv}`);
    }
    levelOf.set(e.character, lv);
  }
  vocabByLevel[lv] = arr(load(`cache/openjlpt/vocab/${lv}.json`));
}
console.log(`levels: ${LEVELS.map((l) => `${l}=${byLevel[l].size}`).join(' ')} (total ${levelOf.size})`);
check(levelOf.size > 2000, 'level list covers the JLPT kanji');
check(byLevel.n1.size > 0, 'N1 is populated', `(${byLevel.n1.size})`);

/* ---- 2. alignment vs Tatoeba ground truth --------------------------- */

/** "もうスミスさんに{会|あ}われましたね。" -> plain text + marked positions */
function splitFurigana(furigana) {
  const marks = [];
  let plain = '';
  let last = 0;
  for (const m of furigana.matchAll(/\{([^}|]+)\|([^}]+)\}/g)) {
    plain += furigana.slice(last, m.index);
    if (m[1].length === 1 && CJK_RE.test(m[1])) marks.push({ at: plain.length, kanji: m[1], reading: m[2] });
    plain += m[1];
    last = m.index + m[0].length;
  }
  plain += furigana.slice(last);
  const reading = furigana.replace(/\{([^}|]+)\|([^}]+)\}/g, '$2');
  return { plain, reading, marks };
}

const sentences = [];
for (const lv of LEVELS) {
  for (const v of vocabByLevel[lv]) {
    for (const ex of v.examples || []) {
      if (!ex.furigana) continue;
      const { plain, reading, marks } = splitFurigana(ex.furigana);
      if (marks.length) sentences.push({ lv, plain, reading, marks, text: ex.furigana });
    }
  }
}

function measure(aligner, rows, collectMisses = 0) {
  let checked = 0;
  let correct = 0;
  const misses = [];
  for (const s of rows) {
    const res = aligner(s.plain, s.reading);
    if (!res) continue;
    for (const g of s.marks) {
      checked++;
      const got = res.perChar[g.at];
      if (got === g.reading) correct++;
      else if (misses.length < collectMisses) misses.push(`${s.text}   want ${g.reading}, got ${got || '(none)'}`);
    }
  }
  return { checked, correct, pct: checked ? (correct / checked) * 100 : 0, misses };
}

const baseline = measure(makeAligner(kanjiDict, new Map()), sentences, 8);
console.log(`\nbaseline (KANJIDIC2 readings only): ${baseline.correct}/${baseline.checked} kanji (${baseline.pct.toFixed(2)}%)`);
for (const m of baseline.misses) console.log('      miss:', m);

const TRAIN = ['n5', 'n4', 'n3'];
const TEST = ['n2', 'n1'];
const mined = mineReadings(TRAIN.flatMap((l) => vocabByLevel[l]), { minCount: 2 });
console.log(`\nmined readings from ${TRAIN.join('/')} examples: ${mined.size} kanji`);
const heldout = measure(makeAligner(kanjiDict, mined), sentences.filter((s) => TEST.includes(s.lv)), 8);
console.log(`held out (never seen ${TEST.join('/')}): ${heldout.correct}/${heldout.checked} kanji (${heldout.pct.toFixed(2)}%)`);
for (const m of heldout.misses) console.log('      miss:', m);

// What the app will actually ship: mined from everything, checked everywhere.
const full = makeAligner(kanjiDict, mineReadings(sentences, { minCount: 2 }));
const overall = measure(full, sentences);
console.log(`\nshipping config (mined from all examples): ${overall.pct.toFixed(2)}%`);

check(baseline.checked > 5000, 'alignment had enough ground truth to be meaningful', `(${baseline.checked} chars)`);
check(baseline.pct > 90, 'baseline alignment > 90% from KANJIDIC2 alone', `(${baseline.pct.toFixed(2)}%)`);
check(heldout.pct > 95, 'mined readings generalise to unseen levels > 95%', `(${heldout.pct.toFixed(2)}%)`);

/* ---- 3. stroke data -------------------------------------------------- */

const vg = parseKanjiVG(readGz('cache/kanjivg.xml.gz'));
const noStrokes = [];
let strokeMismatch = 0;
for (const [ch] of levelOf) {
  const e = kanjiDict.get(ch);
  const paths = vg.get(e && e.cp);
  if (!paths) { noStrokes.push(ch); continue; }
  if (e.strokes && paths.length !== e.strokes) strokeMismatch++;
}
console.log(`\nstroke data: ${levelOf.size - noStrokes.length}/${levelOf.size} kanji have a drawing`);
if (noStrokes.length) console.log(`      missing (${noStrokes.length}):`, noStrokes.join(''));
check(noStrokes.length / levelOf.size < 0.01, 'nearly every JLPT kanji has stroke order');
check(strokeMismatch < levelOf.size * 0.05, 'stroke counts agree with KANJIDIC2', `(${strokeMismatch} differ)`);

/* ---- 4. vocabulary coverage ----------------------------------------- */

// Coverage from the curated `words` field, and from the full vocab pool, which
// is what the build actually uses.
let noCurated = 0;
for (const [ch, lv] of levelOf) {
  const e = byLevel[lv].get(ch);
  if (!e || !e.words || !e.words.length) noCurated++;
}

const pool = new Set();
for (const lv of LEVELS) for (const v of vocabByLevel[lv]) pool.add(v.word);
let noPool = 0;
const noPoolList = [];
for (const [ch, lv] of levelOf) {
  const e = byLevel[lv].get(ch);
  const hit = (e && e.words || []).some((w) => pool.has(w)) ||
    [...pool].some((w) => w.includes(ch));
  if (!hit) { noPool++; if (noPoolList.length < 30) noPoolList.push(ch); }
}
console.log(`\nkanji with no curated words: ${noCurated}`);
console.log(`kanji with no word in the vocab pool: ${noPool} ${noPoolList.join('')}`);
check(noPool / levelOf.size < 0.25, 'most JLPT kanji have an example word', `(${noPool} do not, almost all N1)`);

console.log(`\n${failures ? failures + ' check(s) failed' : 'all checks passed'}`);
process.exit(failures ? 1 : 0);