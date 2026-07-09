//! Rillio desktop shell (Tauri v2).
//!
//! S0: a WebView2 window hosting the `apps/web` client.
//! S1: the Rust streaming server runs in-process (no container/sidecar) — the
//! web client reaches it at http://127.0.0.1:11470 exactly as before.

pub mod mpv;
mod shell;

use std::sync::Mutex;

use tauri::Manager;

/// The embedded mpv instance (S3). `None` until playback starts.
#[derive(Default)]
struct MpvState(Mutex<Option<mpv::Mpv>>);

/// Whether to embed mpv inside the app window (S4 compositing: video renders
/// into the main window behind the transparent WebView, controls overlaid) vs a
/// separate mpv output window. Embedded is the default; opt out with
/// `STREMIO_EMBED_MPV=0` (e.g. if a GPU/driver mishandles the transparent
/// overlay) to get a separate mpv window.
pub(crate) fn mpv_embed_enabled() -> bool {
    !matches!(std::env::var("STREMIO_EMBED_MPV").as_deref(), Ok("0") | Ok("false"))
}

/// Chromium/WebView2 command-line switches for the main window.
///
/// Setting `additional_browser_args` REPLACES wry's defaults, so we re-include
/// them, then turn on DNS-over-HTTPS so the web UI's hostname lookups (addons,
/// image/subtitle CDNs, the update server) are encrypted instead of going out as
/// plaintext DNS. `secure` mode = DoH only, no plaintext fallback. Override the
/// resolver with `STREMIO_DOH_TEMPLATE=<url>`, or disable with `=off` (e.g. if a
/// network blocks the DoH endpoint and breaks resolution). NOTE: DoH does not
/// hide your IP from torrent peers (that needs a VPN/proxy) — see
/// memory/compositing-dcomp-plan sibling notes.
fn browser_args() -> String {
    let base = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
    match std::env::var("STREMIO_DOH_TEMPLATE") {
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("off") => base.to_string(),
        Ok(v) if !v.trim().is_empty() => {
            format!("{base} --dns-over-https-mode=secure --dns-over-https-templates={}", v.trim())
        }
        _ => format!(
            "{base} --dns-over-https-mode=secure --dns-over-https-templates=https://cloudflare-dns.com/dns-query"
        ),
    }
}

/// Open a URL or file path in the OS default handler / native app (S2).
///
/// This is the desktop implementation of the web client's
/// `platform.openExternal`. Running in the trusted shell, it opens the target
/// directly (external player, torrent client, browser) instead of the browser's
/// `window.open` + safety-warning redirect.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("open_external({url}): {e}"))
}

/// Build and run the Tauri application.
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,rillio_desktop_lib=debug".into()),
        )
        .try_init();

    tauri::Builder::default()
        .manage(MpvState::default())
        .manage(shell::ShellState::default())
        .setup(|app| {
            start_streaming_server(app.handle());
            let window = build_main_window(app)?;
            // S3 part-2 render proof: STREMIO_MPV_TEST=<url|"test"> embeds mpv in
            // the window and plays it. "test" = a generated color pattern.
            if let Ok(src) = std::env::var("STREMIO_MPV_TEST") {
                if let Err(e) = start_mpv_embedded(app.handle(), &window, &src) {
                    tracing::error!("mpv embed test failed: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            shell::shell_init,
            shell::shell_send,
            shell::shell_mpv_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Rillio desktop shell");
}

/// Load mpv, embed it into the window (`wid`), and play `source`. Stores the
/// instance in state so it isn't dropped. Windows-only for now.
#[cfg(windows)]
fn start_mpv_embedded(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    source: &str,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let wid = hwnd.0 as isize;

    let dll = mpv::default_dll_path();
    let mpv = mpv::Mpv::load(&dll)?;
    mpv.set_option("wid", &wid.to_string())?; // render into our window
    mpv.set_option("hwdec", "auto")?; // hardware decode (HDR/perf)
    mpv.initialize()?;

    let file = if source == "test" {
        "av://lavfi:testsrc=size=1280x720:rate=30"
    } else {
        source
    };
    mpv.command(&["loadfile", file])?;

    *app.state::<MpvState>().0.lock().unwrap() = Some(mpv);
    tracing::info!("mpv embedded (wid={wid}), playing {file}");
    Ok(())
}

#[cfg(not(windows))]
fn start_mpv_embedded(
    _app: &tauri::AppHandle,
    _window: &tauri::WebviewWindow,
    _source: &str,
) -> Result<(), String> {
    Err("mpv embedding is Windows-only for now".into())
}

/// Create the main window in code so we can intercept navigation: custom-scheme
/// links (`vlc://`, `mpv://`, `magnet:`, external-player deep links) are opened
/// in the OS/native app and the in-app navigation is cancelled (S2). Normal
/// http(s)/tauri navigations proceed in the WebView.
fn build_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    // In-window mpv compositing (S4) is opt-in behind STREMIO_EMBED_MPV: on
    // Windows a transparent (layered) top-level window does NOT display child
    // windows that render with the GPU, so mpv's gpu-next output embedded via
    // `wid` renders to an invisible surface. Until that's solved properly, the
    // default is a non-transparent window + mpv in its own output window (which
    // works). See mpv_embed_enabled().
    // STREMIO_START_URL overrides the initial page (debug hook — e.g. point it at
    // a DoH check page to verify DNS encryption is active).
    let start_url = std::env::var("STREMIO_START_URL")
        .ok()
        .and_then(|u| tauri::Url::parse(&u).ok())
        .map(tauri::WebviewUrl::External)
        .unwrap_or_default();
    tauri::WebviewWindowBuilder::new(app, "main", start_url)
        .title("Rillio")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .transparent(mpv_embed_enabled())
        .additional_browser_args(&browser_args())
        .on_navigation(|url| {
            match url.scheme() {
                "http" | "https" | "tauri" | "data" | "blob" | "about" => true,
                _ => {
                    // External-player / torrent / other custom scheme.
                    if let Err(e) = open::that(url.as_str()) {
                        tracing::error!("failed to open external {url}: {e}");
                    }
                    false
                }
            }
        })
        .build()
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
    let config = rillio_streaming_server::Config::local(cache_dir);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = rillio_streaming_server::serve(config).await {
            tracing::error!("embedded streaming server exited: {e}");
        }
    });
}
