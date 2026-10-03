// Parsers for the raw source files in ./cache. Kept separate from the build
// script so tools/verify.mjs can import them without triggering a rebuild.

import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const KANA_RE = /[\u3041-\u309f\u30a1-\u30ff]/;
export const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export const readGz = (p) => gunzipSync(readFileSync(p)).toString('utf8');

/**
 * KANJIDIC2 -> metadata per character.
 *
 * Note: the <jlpt> tag in this file is not a usable level indicator (日/学/大
 * are all tagged 4 and most N1 kanji carry no tag at all), so levels come from
 * OpenJLPT instead. Everything else here is trustworthy.
 */
export function parseKanjidic(xml) {
  const out = new Map();
  for (const block of xml.split('<character>').slice(1)) {
    const literal = block.match(/<literal>(.*?)<\/literal>/)?.[1];
    if (!literal) continue;

    const cp = block.match(/<cp_value cp_type="ucs">([0-9a-f]+)<\/cp_value>/)?.[1];

    // Only untagged <meaning> elements are English; translations carry m_lang.
    const meanings = [...block.matchAll(/<meaning>(.*?)<\/meaning>/g)].map((m) => m[1]);

    const on = [...block.matchAll(/<reading r_type="ja_on">(.*?)<\/reading>/g)].map((m) => m[1]);

    // KANJIDIC2 writes alternative kun readings as つ.ぐ (either つ or ぐ).
    // Expose each alternative, plus the joined form, since つぐ is how the
    // kanji actually appears in words.
    const kun = new Set();
    for (const m of block.matchAll(/<reading r_type="ja_kun">(.*?)<\/reading>/g)) {
      const raw = m[1];
      if (raw.includes('.')) {
        const parts = raw.split('.');
        parts.forEach((p) => kun.add(p));
        kun.add(parts.join(''));
      } else {
        kun.add(raw);
      }
    }

    out.set(literal, {
      c: literal,
      cp: cp ? parseInt(cp, 16) : null,
      grade: +(block.match(/<grade>(\d+)<\/grade>/)?.[1] ?? NaN) || null,
      strokes: +(block.match(/<stroke_count>(\d+)<\/stroke_count>/)?.[1] ?? NaN) || null,
      freq: +(block.match(/<freq>(\d+)<\/freq>/)?.[1] ?? NaN) || null,
      radical: +(block.match(/<rad_value rad_type="classical">(\d+)<\/rad_value>/)?.[1] ?? NaN) || null,
      on: [...new Set(on)],
      kun: [...kun],
      mean: meanings,
      nanori: [...block.matchAll(/<nanori>(.*?)<\/nanori>/g)].map((m) => m[1]),
    });
  }
  return out;
}

/** KanjiVG -> ordered stroke centreline paths, keyed by codepoint. */
export function parseKanjiVG(xml) {
  const out = new Map();
  for (const block of xml.split('<kanji id="kvg:kanji_').slice(1)) {
    const id = block.match(/^([0-9a-f]+)"/)?.[1];
    if (!id) continue;
    // Document order inside <g kvg:element="..."> is stroke order.
    const paths = [...block.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
    if (paths.length) out.set(parseInt(id, 16), paths);
  }
  return out;
}

/**
 * strokesvg (Klee One, OFL) -> kana glyph markup.
 * The inner SVG is kept whole: stroke paths carry clip-path references into the
 * "shadows" group, so trimming one without the other breaks rendering.
 */
export function readKanaSvgs(dir) {
  const out = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.svg')) continue;
    const raw = readFileSync(`${dir}/${file}`, 'utf8');
    const slim = raw
      .slice(raw.indexOf('>') + 1, raw.lastIndexOf('</svg>'))
      .replace(/\n\s*/g, '')
      .replace(/>\s+</g, '><')
      .trim();
    if (slim) out.set(file.replace(/\.svg$/, ''), { svg: slim, strokes: (slim.match(/--i:/g) || []).length });
  }
  return out;
}