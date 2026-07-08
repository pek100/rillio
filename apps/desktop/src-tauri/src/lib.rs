//! Stremio desktop shell (Tauri v2).
//!
//! S0: a WebView2 window hosting the `apps/web` client.
//! S1: the Rust streaming server runs in-process (no container/sidecar) — the
//! web client reaches it at http://127.0.0.1:11470 exactly as before.

use tauri::Manager;

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            start_streaming_server(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Stremio desktop shell");
}

/// Spawn the embedded streaming server on Tauri's async (tokio) runtime. It
/// binds 127.0.0.1:11470 and owns the torrent cache under the app data dir.
fn start_streaming_server(app: &tauri::AppHandle) {
    let cache_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("streaming-server");
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        tracing::error!("cannot create cache dir {cache_dir:?}: {e}");
    }
    let config = stremio_streaming_server::Config::local(cache_dir);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = stremio_streaming_server::serve(config).await {
            tracing::error!("embedded streaming server exited: {e}");
        }
    });
}
