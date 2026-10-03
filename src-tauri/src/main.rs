// Kanji Study - desktop shell.
//
// The study app is plain HTML/CSS/JS with no server behind it. This shell
// serves those files straight off disk through a custom protocol, so the app
// behaves identically whether it is opened from a folder or as a binary, and it
// never touches the network.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kanjilearn_lib::run();
}