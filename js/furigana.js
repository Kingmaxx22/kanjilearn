// Furigana rendering.
//
// The build gives us, per example word, the kana that belongs to each character
// ("日本" -> ["に","ほん"]). That alignment is what lets us draw real ruby text
// and highlight the character the user came to look at.

import { el } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param word    the written word, e.g. 日本
 * @param perChar space-separated kana per character, e.g. "に ほん"
 * @param target  index of the character to highlight, or -1
 * @param opts.className  extra class on the wrapper
 */
export function rubyWord(word, perChar, target = -1, opts = {}) {
  const chars = [...word];
  const kana = typeof perChar === 'string' ? perChar.trim().split(/\s+/) : (perChar || []);
  const wrap = el('span', { className: opts.className || 'w-jp' });

  chars.forEach((ch, i) => {
    const isTarget = i === target;
    if (!/[\u3400-\u9fff]/.test(ch)) {
      wrap.appendChild(document.createTextNode(ch));
      return;
    }

    const ruby = document.createElement('ruby');
    const base = document.createElement('span');
    base.textContent = ch;
    if (isTarget) base.className = 'target';
    ruby.appendChild(base);

    const reading = kana[i];
    if (reading) {
      const rt = document.createElement('rt');
      rt.textContent = reading;
      if (isTarget) rt.className = 'target-rt';
      ruby.appendChild(rt);
    }
    wrap.appendChild(ruby);
  });

  return wrap;
}

/**
 * Render a Tatoeba furigana string ("お{茶|ちゃ}に") as ruby text.
 * @param highlight  the character being studied, marked in the accent colour
 */
export function furiganaSentence(furigana, highlight = null) {
  const wrap = el('span', { className: 'w-jp' });
  let last = 0;

  for (const m of furigana.matchAll(/\{([^}|]+)\|([^}]+)\}/g)) {
    if (m.index > last) wrap.appendChild(document.createTextNode(furigana.slice(last, m.index)));

    const chars = m[1];
    const ruby = document.createElement('ruby');
    const base = document.createElement('span');
    base.textContent = chars;
    const rt = document.createElement('rt');
    rt.textContent = m[2];

    // A marker can cover several characters ({日本|にほん}), so highlight the
    // piece only when it actually contains the character in question.
    if (highlight && chars.includes(highlight)) {
      base.className = 'target';
      rt.className = 'target-rt';
    }

    ruby.appendChild(base);
    ruby.appendChild(rt);
    wrap.appendChild(ruby);
    last = m.index + m[0].length;
  }

  if (last < furigana.length) wrap.appendChild(document.createTextNode(furigana.slice(last)));
  return wrap;
}

export { SVG_NS };