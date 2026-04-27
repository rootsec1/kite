mod kube_commands;
mod models;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            window::apply_native_window(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kube_commands::guarded_action_preview,
            kube_commands::list_kube_contexts,
            kube_commands::live_snapshot,
            kube_commands::pod_action,
            kube_commands::resource_details
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kite");
}
