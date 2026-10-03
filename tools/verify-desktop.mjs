// Verify the packaged desktop app (Tauri) end to end, with no dev server
// running: every route, the recognition worker, and that nothing hits the network.
//
//   node tools/verify-desktop.mjs [cdp-port]

const PORT = process.argv[2] || '9333';

let ws;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error('no CDP page target (is the app running?)');
}

const target = await connect();
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const errors = [];
const requests = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('UNCAUGHT: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('CONSOLE ERROR: ' + m.params.args.map((a) => a.value ?? '').join(' ').slice(0, 200));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push('LOG: ' + String(m.params.entry.text).slice(0, 160));
  }
  if (m.method === 'Network.requestWillBeSent') {
    requests.push(m.params.request.url);
  }
};

const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 90000);
});

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');

const js = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (m.error) throw new Error(m.error.message);
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'threw');
  return m.result?.result?.value;
};

const goto = async (hash) => {
  await js(`location.hash = ${JSON.stringify(hash)}; void 0`);
  await sleep(2500);
};

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('desktop app:', await js('location.origin + "  |  " + document.title'));
check(/^http:\/\/tauri\.localhost$/.test(await js('location.origin')), 'served from Tauris internal origin');

// Every view renders from embedded assets.
const ROUTES = [
  ['kanji grid', '/kanji/n5', 'tile'],
  ['kanji detail', '/kanji/n5/%E6%97%A5', 'How it is actually read'],
  ['kana chart', '/kana/hira', 'あ'],
  ['kana detail', '/kana/hira/%E3%81%82', '3 / 3'],
  ['study setup', '/study', 'Start session'],
];

for (const [label, route, want] of ROUTES) {
  await goto(route);
  const html = await js("document.querySelector('#view')?.innerHTML || ''");
  check(html.includes(want) && !html.includes('Something went wrong'), `${label} renders`, `${route}`);
}

// Stroke geometry really came out of the embedded SVG paths.
await goto('/kanji/n5/%E6%97%A5');
check(await js("document.querySelectorAll('.glyph-stage svg path').length") === 4, 'kanji stroke paths drawn (4)');
check((await js("document.querySelectorAll('.w-jp ruby').length")) > 0, 'furigana ruby rendered');

// Draw-to-search: the module Worker must load over the internal origin.
await goto('/draw/%E6%97%A5');
check(await js("!!document.querySelector('.glyph-stage')"), 'draw ghost rendered');

let status = '';
for (let i = 0; i < 45; i++) {
  status = await js("document.querySelector('.build-note')?.textContent || ''");
  if (/Ready|unavailable/i.test(status)) break;
  await sleep(2000);
}
check(/Ready — \d+ characters/.test(status), 'recognition worker became ready', status.slice(0, 60));

// Exercise a search through the worker.
const drew = await js(`(() => {
  const pad = document.querySelector('canvas.pad');
  const r = pad.getBoundingClientRect();
  const ev = (t, x, y) => pad.dispatchEvent(new PointerEvent(t, { pointerId: 1, bubbles: true, clientX: x, clientY: y }));
  const line = (x0, x1, y) => {
    ev('pointerdown', r.x + (x0/320)*r.width, r.y + (y/320)*r.height);
    ev('pointermove', r.x + ((x0+x1)/2/320)*r.width, r.y + (y/320)*r.height);
    ev('pointerup', r.x + (x1/320)*r.width, r.y + (y/320)*r.height);
  };
  line(40, 280, 60); line(40, 280, 260); line(40, 280, 160);
  ev('pointerdown', r.x + (160/320)*r.width, r.y + (60/320)*r.height);
  ev('pointerup', r.x + (160/320)*r.width, r.y + (260/320)*r.height);
  return 1;
})()`);
await sleep(2500);
const cands = await js("[...document.querySelectorAll('.candidates .candidate .ch')].map(c=>c.textContent).join(' ')");
check(!!drew && cands.length > 0, 'draw-to-search returned candidates', cands.slice(0, 40));

// Nothing may leave the machine.
const external = requests.filter((u) => !/^http:\/\/tauri\.localhost/.test(u) && !u.startsWith('data:') && !u.startsWith('blob:'));
check(external.length === 0, 'no network requests off-origin', external.slice(0, 3).join(' '));

const realErrors = errors.filter((e) => !/favicon|devtools/i.test(e));
check(realErrors.length === 0, 'no console errors', realErrors.slice(0, 2).join(' | '));

console.log(`\n${failures ? failures + ' check(s) failed' : 'desktop app verified: all checks passed'}`);
ws.close();
process.exit(failures ? 1 : 0);