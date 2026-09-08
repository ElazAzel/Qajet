// На Windows подавляет консольное окно у релизной сборки GUI-приложения —
// стандартная строчка из шаблона Tauri, не специфична для QAJET.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    qajet_desktop_lib::run();
}
