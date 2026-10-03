// Entry point: theme, hash router, service worker.

import { el, clear, store } from './js/util.js';
import { data } from './js/store.js';

import * as kanjiView from './js/views/kanji.js';
import * as kanaView from './js/views/kana.js';
import * as drawView from './js/views/draw.js';
import * as studyView from './js/views/study.js';

const mount = document.getElementById('view');

/* ---- theme ---------------------------------------------------------- */

const THEME_KEY = 'theme';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#16151a' : '#f7f4ee');
}

applyTheme(store.get(THEME_KEY,
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set(THEME_KEY, next);
});

/* ---- routing -------------------------------------------------------- */

const ROUTES = {
  kanji: kanjiView,
  kana: kanaView,
  draw: drawView,
  study: studyView,
};

let current = null;
let routeToken = 0;

function parseHash() {
  return decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
}

function highlightTab(path) {
  for (const a of document.querySelectorAll('#tabs a')) {
    const isActive = a.dataset.tab === path;
    if (isActive) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function route() {
  const segs = parseHash();
  const name = segs[0] || 'kanji';
  const view = ROUTES[name] || ROUTES.kanji;
  const token = ++routeToken;

  // Let the outgoing view release canvases, workers and animation frames.
  if (current && current.destroy) {
    try { current.destroy(); } catch { /* keep routing */ }
  }
  current = null;

  highlightTab(ROUTES[name] ? name : 'kanji');
  clear(mount);
  mount.scrollTop = 0;
  window.scrollTo(0, 0);

  try {
    const result = await view.render(segs.slice(1), mount);
    // A newer route started while this one awaited; drop this result on the floor
    // rather than appending it into whatever is on screen now.
    if (token !== routeToken) {
      if (result && result.destroy) { try { result.destroy(); } catch { /* ignore */ } }
      return;
    }
    current = result || null;
  } catch (err) {
    if (token !== routeToken) return;
    console.error(err);
    clear(mount);
    mount.appendChild(el('div', { className: 'empty' },
      'Something went wrong loading this view.',
      el('div', { style: { marginTop: '10px', fontSize: '13px' } }, String(err.message || err))));
  }
}

window.addEventListener('hashchange', route);

/* ---- service worker -------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is a bonus, not a requirement.
    });
  });
}

/* ---- go -------------------------------------------------------------- */

// Start once the index is available, so the first route has data to work with.
// Calling route() here as well would render every view twice.
(async () => {
  try {
    await data.loadIndex();
  } catch (err) {
    clear(mount);
    mount.appendChild(el('div', { className: 'empty' },
      'Could not load the data bundle.',
      el('div', { style: { marginTop: '10px', fontSize: '13px' } },
        'Run `node tools/build-data.mjs` to generate it.')));
    return;
  }
  route();
})();