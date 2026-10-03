# Android app

The study app is a static site with no server behind it. This shell packages it
as an Android app that runs entirely offline, using the same Tauri shell as the
Windows desktop build — see [DESKTOP.md](DESKTOP.md) for how the shell works and
why it is a webview rather than a folder of HTML.

## What you get

| Artefact | Size | What it is |
| --- | --- | --- |
| `dist-android/KanjiStudy-<version>-arm64-v8a-signed.apk` | 7.9 MB | Release APK, arm64, ready to install |

Everything travels inside the APK: 2381 kanji across N5–N1, 163 kana, the 2.17 MB
draw-to-search index, and all the data bundles. There are no loose asset files.

## Prerequisites

Windows, macOS or Linux all work — Gradle builds from any host.

- **Rust** with the Android targets:

  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi \
                    i686-linux-android x86_64-linux-android
  ```

- **Android SDK** with a platform, build-tools and platform-tools. Installing
  Android Studio gets you all of these.
- **Android NDK** — Rust cross-compiles through its linker. Any recent r26+ is
  fine; this project was built against **r27c (27.0.12077973)**.
- **JDK 17 or newer**. Android Studio bundles one at
  `jbr`, and the build script finds it automatically.
- **Tauri CLI**: `cargo install tauri-cli --version "^2" --locked`

Everything is found from the environment:

```bash
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"   # Windows
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
```

If `NDK_HOME` is unset the script uses the newest NDK under `$ANDROID_HOME/ndk`.
With no `JAVA_HOME` it uses Android Studio's bundled runtime, else `java` from
`PATH`.

### Windows: Developer Mode

Tauri links the compiled `libkanjilearn_lib.so` into the Gradle project with a
symbolic link, which Windows refuses to create unless Developer Mode is on. The
build fails with *"Creation symbolic link is not allowed for this system"* if it
is off. Either turn it on in **Settings → Privacy & security → For developers**,
or from an elevated shell:

```bash
reg add 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' \
    /v AllowDevelopmentWithoutDevLicense /t REG_DWORD /d 1 /f
reg add 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' \
    /v DeveloperMode /t REG_DWORD /d 1 /f
```

In Git Bash prefix those with `MSYS_NO_PATHCONV=1`, or the `/v` and `/t` flags
get mangled into file paths.

## Build

```bash
./tools/build-android.sh              # signed arm64 release APK
./tools/build-android.sh --all-abis   # every ABI (bigger APK, slower build)
./tools/build-android.sh --unsigned   # skip signing
```

Steps, in order: rebuild the data bundles (the shell embeds them), generate the
Android project if it is missing, cross-compile, then sign. It prints the APK
path and the `adb install` command to go with it.

The first build is slow — it downloads the Gradle distribution, the Android
Gradle plugin and the NDK's dependencies. Later builds reuse the Gradle cache
and take a couple of minutes.

## Signing

Android will not install an unsigned APK, and it refuses to *update* an app
signed with a different key. That makes the keystore the one thing in this
project worth keeping:

- `.keys/kanjilearn.jks` — the signing key
- `.keys/PASSWORD.txt` — its password

Both are gitignored. Back them up somewhere safe: **lose the keystore and the
only way to install a new build is to uninstall the app first**, which loses all
study and tracing progress on the phone.

To create a new one:

```bash
keytool -genkeypair -v -keystore .keys/kanjilearn.jks \
  -alias kanjilearn -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <password> -keypass <password> \
  -dname "CN=Kanji Study, O=Kanji Study, C=GB"
```

The build script signs with `apksigner` from build-tools and verifies the result
before reporting success.

## Install

Over USB, with Developer options and USB debugging enabled on the phone:

```bash
adb install -r dist-android/KanjiStudy-<version>-arm64-v8a-signed.apk
```

`-r` replaces an existing install, keeping its data — which only works if it was
signed with the same keystore.

Or copy the APK to the phone and open it, allowing installs from that source
when prompted.

## Verify

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs <apk>
$ANDROID_HOME/build-tools/<version>/aapt2 dump badging <apk>
```

`badging` should report `package: name='app.kanji.study'`,
`versionName` matching `tauri.conf.json`, and `minSdkVersion:'24'`.

To confirm the app really is self-contained, check that the shell binary carries
the whole web app:

```bash
python - <<'PY'
import re, zipfile
with zipfile.ZipFile('dist-android/KanjiStudy-1.0.3-arm64-v8a-signed.apk') as z:
    so = z.read('lib/arm64-v8a/libkanjilearn_lib.so')
paths = sorted({p.decode() for p in re.findall(rb'(?:index\.html|styles\.css|app\.js|js/[\w./-]+|data/[\w./-]+)', so)})
print(len(paths), 'embedded files')
print('\n'.join('  ' + p for p in paths))
PY
```

Every module and data bundle should be listed, and `sw.js` should **not** be:
the service worker only makes sense for the hosted app, and `build.rs` strips it
from the bundled copy.

## Layout

```
src-tauri/
  gen/android/          the Android Studio project, tracked in git
    app/src/main/       manifest, MainActivity, jniLibs (the .so is linked in)
    build.gradle.kts    namespace, minSdk 24, ABI packaging
  src/lib.rs            the same Builder as desktop, entered via
                        #[cfg_attr(mobile, tauri::mobile_entry_point)]
tools/
  build-android.sh      data -> generate -> compile -> sign
dist-android/           signed APKs, gitignored
.keys/                  signing key, gitignored
```

`src-tauri/gen/android` is committed, unlike the rest of `gen/`. It is source —
the Android Studio project — not build output, and its own `.gitignore` drops
the Gradle build directories and the `.so` that gets linked in.

## Still to do

Nothing is verified on a physical device yet: the APK is built, signed and
checked as an archive, but it has not been launched on Android. The first run on
a phone is the real test.