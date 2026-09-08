use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Оболочка консьержа для ПК — план §"Оболочка ПК", agents.md фаза 7.
/// Настоящей фронтенд-сборки внутри нет: главное окно грузит боевой адрес
/// Vercel (`app.windows[].url` в tauri.conf.json) напрямую, тем же кодом
/// apps/web, что и браузер. Tauri добавляет поверх web-приложения ровно то,
/// что нельзя сделать в браузере: нативное меню, трей, глобальный хоткей,
/// deep link `qajet://order/...`, автопамять положения окна и одиночный
/// экземпляр приложения.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Второй запуск .app/.exe не открывает новое окно — фокусирует текущее
    // и передаёт ему deep-link аргументы (важно для `qajet://order/...`,
    // открытого из письма/чата, когда приложение уже работает).
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
        if let Some(url) = argv.iter().find(|a| a.starts_with("qajet://")) {
            let _ = app.emit("deep-link", url.clone());
        }
    }));

    builder = builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Глобальный хоткей ⌘⇧Space (Ctrl⇧Space на Windows/Linux) —
            // поднимает окно из любого приложения, как командная палитра.
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = handle.emit("global-shortcut:command-palette", ());
                    }
                }
            })?;

            // Нативное меню приложения — только пункты, которых нет
            // физически ни у одного веб-приложения (Cmd+Q, About, Cmd+,).
            let about = PredefinedMenuItem::about(app, Some("О QAJET"), None)?;
            let settings = MenuItem::with_id(app, "settings", "Настройки…", true, Some("CmdOrCtrl+,"))?;
            let quit = PredefinedMenuItem::quit(app, Some("Выйти"))?;
            let app_menu = Submenu::with_items(app, "QAJET", true, &[&about, &settings, &quit])?;

            let reload = MenuItem::with_id(app, "reload", "Обновить", true, Some("CmdOrCtrl+R"))?;
            let view_menu = Submenu::with_items(app, "Вид", true, &[&reload])?;

            let menu = Menu::with_items(app, &[&app_menu, &view_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| match event.id().0.as_str() {
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("location.reload()");
                    }
                }
                "settings" => {
                    let _ = app.emit("menu:settings", ());
                }
                _ => {}
            });

            // Системный трей — сворачивание в фон без полного выхода,
            // характерное для настольного приложения, не для вкладки браузера.
            let tray_quit = MenuItem::with_id(app, "tray-quit", "Выйти", true, None::<&str>)?;
            let tray_show = MenuItem::with_id(app, "tray-show", "Открыть QAJET", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&tray_show, &tray_quit])?;
            TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().0.as_str() {
                    "tray-quit" => app.exit(0),
                    "tray-show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running qajet desktop shell");
}
