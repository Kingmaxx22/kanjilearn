#!/usr/bin/env bash
# Build the Android APK end to end.
#
#   ./tools/build-android.sh                 signed release APK (arm64)
#   ./tools/build-android.sh --all-abis      signed APK containing every ABI
#   ./tools/build-android.sh --unsigned      skip signing
#
# Steps, in order: rebuild the data bundles (the shell embeds them), generate
# the Android project if it is missing, cross-compile the Rust shell for
# Android, then sign the APK with the local keystore.
#
# The Android SDK, NDK and JDK are found from the usual environment variables;
# see ANDROID.md for what to install and where.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CARGO_BIN="$HOME/.cargo/bin"
[ -d "$CARGO_BIN" ] && export PATH="$PATH:$CARGO_BIN"

TARGET="aarch64"          # arm64-v8a, which is every phone made in the last decade
SIGN=1
for arg in "$@"; do
  case "$arg" in
    --all-abis)   TARGET="" ;;
    --unsigned)   SIGN=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$1"; }
die() { echo "$1" >&2; exit 1; }

# ---- toolchain -----------------------------------------------------------

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}}"
[ -d "$ANDROID_HOME" ] || die "Android SDK not found at $ANDROID_HOME (set ANDROID_HOME)"

# The JDK ships with Android Studio, which is the one already on a machine that
# has the SDK. Fall back to whatever java is on PATH.
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/c/Program Files/Android/Android Studio/jbr" \
    "/c/Program Files/Android/Android Studio/jre"; do
    [ -d "$candidate" ] && export JAVA_HOME="$candidate" && break
  done
fi
[ -n "${JAVA_HOME:-}" ] || command -v java >/dev/null || die "no JDK found (set JAVA_HOME)"

# Pick the newest NDK if NDK_HOME is not set: Tauri picks one, but being
# explicit keeps the build reproducible.
if [ -z "${NDK_HOME:-}" ]; then
  for d in "$ANDROID_HOME"/ndk/*/; do
    [ -d "$d" ] && NDK_HOME="${d%/}"
  done
fi
[ -n "${NDK_HOME:-}" ] || die "no NDK under $ANDROID_HOME/ndk (see ANDROID.md)"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME" NDK_HOME ANDROID_NDK_HOME="$NDK_HOME"

BUILD_TOOLS="$(ls -1d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | tail -1)"
[ -n "$BUILD_TOOLS" ] || die "no build-tools in $ANDROID_HOME (see ANDROID.md)"
APKSIGNER="$BUILD_TOOLS/apksigner.bat"

printf 'sdk   %s\nndk   %s\njava  %s\n' "$ANDROID_HOME" "$NDK_HOME" "${JAVA_HOME:-on PATH}"

# ---- data ----------------------------------------------------------------

step "icons"
# `cargo tauri android init` writes the default Tauri logo into the mipmap
# folders, so the launcher icon is regenerated from ours on every build.
node tools/app-icon.mjs >/dev/null

step "data bundles"
# The shell embeds these, so a stale or missing bundle ships a broken app.
node tools/build-data.mjs | tail -3

step "verify data"
node tools/verify.mjs | tail -2

# ---- project -------------------------------------------------------------

step "android project"
if [ ! -d src-tauri/gen/android ]; then
  echo "generating (cargo tauri android init)"
  (cd src-tauri && cargo tauri android init --ci)
else
  echo "already generated: src-tauri/gen/android"
fi

echo "launcher icons"
(cd src-tauri && cargo tauri icon ../build/icon-256.png >/dev/null)

# ---- compile -------------------------------------------------------------

step "compile (release)"
cd src-tauri
if [ -n "$TARGET" ]; then
  cargo tauri android build --apk --target "$TARGET"
else
  cargo tauri android build --apk
fi
cd "$ROOT"

# Gradle names the output after the build type rather than the ABI, so glob for
# it rather than hard-coding one path.
UNSIGNED="$(ls -t src-tauri/gen/android/app/build/outputs/apk/*/release/*unsigned*.apk 2>/dev/null | head -1)"
[ -n "$UNSIGNED" ] || die "no unsigned apk was produced"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"

# Gradle names the output after the build type, so the filename says
# "universal" even when only one ABI was compiled in. Ask the archive which
# ABIs it really contains rather than trusting the name.
ABI="$(python - "$UNSIGNED" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    abis = sorted({n.split('/')[1] for n in z.namelist() if n.startswith('lib/')})
print('-'.join(abis) if abis else 'unknown')
PY
)"
OUT="dist-android/KanjiStudy-$VERSION-$ABI-signed.apk"

step "sign"
if [ "$SIGN" -eq 0 ]; then
  echo "skipped (--unsigned); the apk is $UNSIGNED"
  OUT="$UNSIGNED"
else
  KEYSTORE=".keys/kanjilearn.jks"
  [ -f "$KEYSTORE" ] || die "no keystore at $KEYSTORE - see ANDROID.md for how to create one"
  PW="$(cat .keys/PASSWORD.txt 2>/dev/null || true)"
  [ -n "$PW" ] || die "no password in .keys/PASSWORD.txt"

  mkdir -p dist-android
  "$APKSIGNER" sign \
    --ks "$KEYSTORE" --ks-key-alias kanjilearn \
    --ks-pass "pass:$PW" --key-pass "pass:$PW" \
    --out "$OUT" "$UNSIGNED"
  "$APKSIGNER" verify "$OUT" || die "signature does not verify"
  echo "verified"
fi

printf '\n=== done ===\n'
ls -lh "$OUT"
printf '\nInstall with: adb install -r %s\n' "$OUT"