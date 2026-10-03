#!/usr/bin/env bash
# Build the desktop app end to end.
#
#   ./tools/build-desktop.sh            release exe + NSIS installer
#   ./tools/build-desktop.sh --no-installer
#
# Steps, in order: refresh icons, rebuild the data bundles (the shell embeds
# them, so they must exist), then compile and bundle.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CARGO_BIN="$HOME/.cargo/bin"
[ -d "$CARGO_BIN" ] && export PATH="$PATH:$CARGO_BIN"

step() { printf '\n=== %s ===\n' "$1"; }

step "icons"
node tools/app-icon.mjs
python tools/make-ico.py

step "data bundles"
# The shell embeds these, so a stale or missing bundle ships a broken app.
node tools/build-data.mjs | tail -3

step "verify data"
node tools/verify.mjs | tail -2

step "compile (release)"
cd src-tauri
if [ "${1:-}" = "--no-installer" ]; then
  cargo build --release
else
  if ! cargo tauri --version >/dev/null 2>&1; then
    echo "the tauri cli is needed for the installer: cargo install tauri-cli --version '^2' --locked" >&2
    echo "re-run with --no-installer to skip bundling" >&2
    exit 1
  fi
  cargo tauri build --bundles nsis
fi

printf '\n=== done ===\n'
ls -lh target/release/kanjilearn.exe 2>/dev/null || true
ls -lh target/release/bundle/nsis/*.exe 2>/dev/null || true