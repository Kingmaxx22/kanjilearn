// The application builder.
//
// The web assets are embedded into the binary at compile time (see build.rs and
// tauri.conf.json), which is what makes the app genuinely portable: there are
// no loose files to lose, no server to start, and no network access.
//
// Tauri serves the embedded frontend itself over an internal origin, so the
// page gets a real secure origin. That matters here: the app uses ES module
// imports, fetch() and a module Worker, all of which fail on file:// URLs.

#[cfg(debug_assertions)]
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Devtools only exist in debug builds; release builds are windows
            // subsystem apps with no console and no developer surface. The
            // parameter is `_app` because release builds never touch it.
            #[cfg(debug_assertions)]
            _app
                .get_webview_window("main")
                .expect("main window")
                .open_devtools();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the kanji study app");
}