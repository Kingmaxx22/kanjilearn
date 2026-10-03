#!/usr/bin/env bash
# Launch the desktop app with WebView2 remote debugging enabled, then print the
# CDP endpoint. Lets the real embedded webview be inspected with the same tooling
# used for the browser checks.
#
#   ./tools/launch-debug.sh [cdp-port]

set -uo pipefail
PORT="${1:-9333}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="$ROOT/src-tauri/target/release/kanjilearn.exe"

[ -f "$EXE" ] || { echo "build first: (cd src-tauri && cargo build --release)" >&2; exit 1; }

taskkill //F //IM kanjilearn.exe >/dev/null 2>&1 || true

export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$PORT --remote-allow-origins=*"

(cd "$(dirname "$EXE")" && ./kanjilearn.exe >/dev/null 2>&1 &)

for i in $(seq 1 40); do
  sleep 1
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json" >/dev/null 2>&1; then
    echo "CDP ready on http://127.0.0.1:$PORT"
    exit 0
  fi
done

echo "app launched but no CDP endpoint on :$PORT (window may still be opening)" >&2
exit 1