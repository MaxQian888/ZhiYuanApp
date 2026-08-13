mod commands;

use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

static NEXT_LAUNCH_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Emitter;
        use tauri_plugin_window_state::StateFlags;

        let window_state_flags = StateFlags::SIZE
            | StateFlags::POSITION
            | StateFlags::MAXIMIZED
            | StateFlags::VISIBLE
            | StateFlags::FULLSCREEN;

        builder = builder
            // This must stay first so later plugins cannot intercept a second launch.
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let payload = commands::SingleInstancePayload {
                    request_id: NEXT_LAUNCH_REQUEST_ID.fetch_add(1, Ordering::Relaxed),
                    args,
                    cwd,
                };
                app.state::<commands::PendingSingleInstanceLaunches>()
                    .push(payload.clone());
                let _ = app.emit_to("main", "single-instance", payload);
            }))
            .plugin(tauri_plugin_positioner::init())
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    // Decorations are configuration, not user state: restoring an old
                    // decorated value would break the frameless window after upgrades.
                    .with_state_flags(window_state_flags)
                    .build(),
            )
            .plugin(tauri_plugin_os::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(commands::PendingSingleInstanceLaunches::default())
        .invoke_handler(tauri::generate_handler![
            commands::platform_info,
            commands::take_pending_single_instance_launches,
            commands::acknowledge_single_instance_launch
        ])
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data directory")
                .join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
