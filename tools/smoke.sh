#!/usr/bin/env bash
# Smoke test: load every route in headless Chrome and fail on any console error.
#
#   ./tools/smoke.sh            # starts its own server on port 8138
#   ./tools/smoke.sh 3000       # use an already-running server on that port
#
# Catches the class of bug where one module has a syntax error and silently
# takes every view down with it.

set -uo pipefail

PORT="${1:-8138}"
CHROME=""
for p in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
         "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
         "$(command -v google-chrome 2>/dev/null)" \
         "$(command -v chromium 2>/dev/null)"; do
  [ -n "$p" ] && [ -x "$p" ] && CHROME="$p" && break
done

if [ -z "$CHROME" ]; then
  echo "chrome not found" >&2
  exit 2
fi

STARTED=""
if ! curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/index.html"; then
  echo "starting server on :$PORT"
  (cd "$(dirname "$0")/.." && nohup python -m http.server "$PORT" >/dev/null 2>&1 &)
  STARTED=1
  sleep 2
fi

PROFILE=$(mktemp -d)
trap 'rm -rf "$PROFILE"; [ -n "$STARTED" ] && pkill -f "http.server $PORT" 2>/dev/null' EXIT

# route-label pairs
ROUTES=(
  "kanji-grid:/kanji/n5"
  "kanji-n1:/kanji/n1"
  "kanji-detail:/kanji/n5/%E6%97%A5"
  "kanji-detail-n1:/kanji/n1/%E9%A1%8E"
  "kana-chart:/kana/hira"
  "kana-chart-kata:/kana/kata"
  "kana-detail:/kana/hira/%E3%81%82"
  "kana-detail-kata:/kana/kata/%E3%83%90"
  "draw:/draw"
  "draw-with-ghost:/draw/%E6%97%A5"
  "learn:/learn"
  "learn-kana:/learn/hira"
  "learn-kanji:/learn/n5"
  "learn-practice:/learn/n5/%E6%97%A5"
  "learn-kana-practice:/learn/hira/%E3%81%82"
  "study:/study"
  "study-single:/study/%E6%97%A5"
)

# Content each route must actually contain. Without these, a view that renders
# an empty shell passes: the draw view used to sit on "Preparing..." forever.
#   marker|route|required text
MARKERS=(
  "kanji-grid|/kanji/n5|tile"
  "kanji-n1|/kanji/n1|tile"
  "kanji-detail|/kanji/n5/%E6%97%A5|How it is actually read"
  "kanji-detail-n1|/kanji/n1/%E9%A1%8E|In sentences"
  "kana-chart|/kana/hira|あ"
  "kana-chart-kata|/kana/kata|ア"
  "kana-detail|/kana/hira/%E3%81%82|3 / 3"
  "kana-detail-kata|/kana/kata/%E3%83%90|4 / 4"
  "draw|/draw|Draw to search"
  "draw-with-ghost|/draw/%E6%97%A5|glyph-stage"
  "learn|/learn|Learn to write"
  "learn-kana|/learn/hira|learn-cell"
  "learn-kanji|/learn/n5|learn-cell"
  "learn-practice|/learn/n5/%E6%97%A5|Now trace it"
  "learn-kana-practice|/learn/hira/%E3%81%82|Now trace it"
  "study|/study|Start session"
  "study-single|/study/%E6%97%A5|Start session"
)

fail=0
for entry in "${ROUTES[@]}"; do
  label="${entry%%:*}"
  route="${entry#*:}"
  out=$("$CHROME" --headless=new --disable-gpu --no-sandbox \
        --user-data-dir="$PROFILE" --enable-logging=stderr --log-level=0 \
        --virtual-time-budget=15000 --window-size=1280,1600 \
        --dump-dom "http://localhost:$PORT/index.html#$route" 2>&1 >/tmp/smoke_dom.html)

  errors=$(echo "$out" | grep -oiE 'CONSOLE.*(Uncaught|Error:|Failed to load|not defined|Cannot read)' \
           | grep -viE 'favicon' | head -3)

  if echo "$out" | grep -q "Something went wrong"; then
    msg=$(sed -e 's/<[^>]*>/ /g' /tmp/smoke_dom.html | grep -o "Something went wrong.*" | head -c 160)
    printf 'FAIL  %-18s %s\n' "$label" "$msg"
    fail=1
  elif [ -n "$errors" ]; then
    printf 'FAIL  %-18s %s\n' "$label" "$errors"
    fail=1
  else
    # sanity: the view should have produced something
    if grep -q 'class="loading"' /tmp/smoke_dom.html; then
      printf 'FAIL  %-18s still showing "Loading…"\n' "$label"
      fail=1
    else
      # The required-text check for this route, if it has one.
      want=""
      for m in "${MARKERS[@]}"; do
        [ "${m%%|*}" = "$label" ] && want="${m##*|}"
      done
      if [ -n "$want" ] && ! grep -q -- "$want" /tmp/smoke_dom.html; then
        printf 'FAIL  %-18s missing expected content: %s\n' "$label" "$want"
        fail=1
      else
        bytes=$(wc -c < /tmp/smoke_dom.html)
        printf 'ok    %-18s %s bytes\n' "$label" "$bytes"
      fi
    fi
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "all routes rendered cleanly"
else
  echo "smoke test failed"
fi
exit "$fail"