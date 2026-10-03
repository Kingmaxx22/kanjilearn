// Small shared helpers.

/** Terse element builder: el('div.card', {onclick}, child, 'text') */
export function el(spec, props = null, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v;
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }

  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

export const $ = (sel, root = document) => root.querySelector(sel);

/* ---- storage ------------------------------------------------------- */

const PREFIX = 'kanji-study:';

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

/* ---- toast --------------------------------------------------------- */

let toastTimer;
export function toast(message, ms = 2000) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

/* ---- misc ---------------------------------------------------------- */

export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Katakana -> hiragana, used to compare readings. */
export const toHiragana = (s) =>
  s.replace(/[\u30a1-\u30f6]/g, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x30f4) return '\u3094';
    if (cp === 0x30f5) return '\u3095';
    if (cp === 0x30f6) return '\u3096';
    return String.fromCodePoint(cp - 0x60);
  });

/** Is this kana a small form (ゃゅょっ etc.)? */
export const isSmallKana = (c) => '\u3041\u3043\u3045\u3047\u3063\u3083\u3085\u3087\u308e\u3095\u3096\u30a1\u30a3\u30a5\u30a7\u30c3\u30e3\u30e5\u30e7\u30ee\u30f5\u30f6'.includes(c);