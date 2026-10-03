// Service worker: makes the app installable and usable offline.
//
// The shell is precached on install. Data bundles are cached the first time they
// are fetched (cache-first), because they are large, versioned by build and
// never change within a session.

const VERSION = 'v5';
const SHELL_CACHE = `kanji-shell-${VERSION}`;
const DATA_CACHE = `kanji-data-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './js/util.js',
  './js/store.js',
  './js/pad.js',
  './js/furigana.js',
  './js/strokes.js',
  './js/recognizer.js',
  './js/recognizer.worker.js',
  './js/views/kanji.js',
  './js/views/kana.js',
  './js/views/learn.js',
  './js/views/draw.js',
  './js/views/study.js',
  './data/index.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('kanji-') && k !== SHELL_CACHE && k !== DATA_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isData = url.pathname.includes('/data/');

  event.respondWith((async () => {
    const cache = await caches.open(isData ? DATA_CACHE : SHELL_CACHE);
    const hit = await cache.match(request);

    // Data bundles only change when the build runs, so cache-first is right.
    if (hit && isData) return hit;

    // Shell files are hand-edited, so serve the cached copy immediately and
    // refresh it in the background. Without this, a fix never reaches anyone
    // who has already visited the app once.
    if (hit) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok && fresh.type === 'basic') await cache.put(request, fresh.clone());
        } catch { /* offline: keep what we have */ }
      })());
      return hit;
    }

    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch (err) {
      // Offline and not cached: fall back to the shell for navigations so the
      // app still opens.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});