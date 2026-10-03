# Desktop app

The study app is a static site with no server behind it. This shell packages it
as a native Windows app that runs entirely offline.

## What you get

| Artefact | Size | What it is |
| --- | --- | --- |
| `kanjilearn.exe` | ~5.2 MB | Self-contained binary. Copy it anywhere and run it. |
| `Kanji Study_1.0.0_x64-setup.exe` | ~3.3 MB | NSIS installer (current-user install, no admin needed). |

Everything travels inside the executable: 2381 kanji across N5–N1, 163 kana,
and the 2.17 MB draw-to-search index. There are no loose asset files to keep
next to it.

## Build

```bash
./tools/build-desktop.sh                    # exe + installer
./tools/build-desktop.sh --no-installer     # exe only
```

Requirements (all present on this machine):

- Rust with the `x86_64-pc-windows-msvc` target
- Visual Studio 2022 build tools (the MSVC linker)
- WebView2 runtime (ships with Windows 10/11)
- Node and Python, for the icon and data steps

The Tauri CLI is only needed for the installer:

```bash
cargo install tauri-cli --version "^2" --locked
```

## How it stays offline

The web files are compiled into the binary by `src-tauri/build.rs` and served by
Tauri over its own internal origin (`http://tauri.localhost`). That origin
matters: the app uses ES module imports, `fetch()` and a module `Worker`, and all
three are blocked on `file://` URLs. It is why this is a webview shell rather
than a loose folder of HTML.

The capability set grants only core window permissions, and the CSP restricts
every directive to `'self'`. Nothing in the app can open a socket.

`sw.js` is stripped from the bundled copy: the service worker exists so the
*served* app works offline, and inside the binary every file is already local.
Registering it on a custom scheme can also delay first paint.

## Verify

The same checks used for the browser build, run against the real packaged app
with no dev server running:

```bash
./tools/launch-debug.sh          # start the app with WebView2 remote debugging
node tools/verify-desktop.mjs    # every view, the worker, and no-network proof
```

`verify-desktop.mjs` confirms each route renders from embedded assets, that
stroke geometry and furigana appear, that the recognition worker reaches
`Ready — 2539 characters loaded`, and that no request ever leaves the origin.

To prove there is no hidden dependency on the repo, copy the exe somewhere empty
and run it:

```bash
mkdir -p /tmp/kjtest && cp src-tauri/target/release/kanjilearn.exe /tmp/kjtest/
```

## Layout

```
src-tauri/
  Cargo.toml        pinned to tauri 2.12
  tauri.conf.json   window, CSP, capability scope, bundle targets
  build.rs          copies index.html, js/, data/ into src-tauri/web
  src/main.rs       entry point
  src/lib.rs        window setup
  capabilities/     core window permissions only
tools/
  app-icon.mjs      renders icon.svg to the PNG sizes Tauri needs
  make-ico.py       packs them into a multi-resolution .ico
  build-desktop.sh  icons -> data -> verify -> compile -> bundle
  launch-debug.sh   run the app with remote debugging on
  verify-desktop.mjs  end-to-end checks against the packaged app
```

## Changing the app

The web app is still the single source of truth. Edit `js/`, `styles.css` or
`app.js` as usual, then rebuild — `build.rs` re-embeds whatever is in the repo,
so the desktop app never drifts from the browser app.

Regenerate `data/` with `node tools/build-data.mjs` before building the shell;
`build.rs` fails loudly if the bundles are missing rather than shipping a
content-free app.