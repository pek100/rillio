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
/// `RILLIO_EMBED_MPV=0` (e.g. if a GPU/driver mishandles the transparent
/// overlay) to get a separate mpv window.
pub(crate) fn mpv_embed_enabled() -> bool {
    !matches!(std::env::var("RILLIO_EMBED_MPV").as_deref(), Ok("0") | Ok("false"))
}

/// Chromium/WebView2 command-line switches for the main window.
///
/// Setting `additional_browser_args` REPLACES wry's defaults, so we re-include
/// them, then turn on DNS-over-HTTPS so the web UI's hostname lookups (addons,
/// image/subtitle CDNs, the update server) are encrypted instead of going out as
/// plaintext DNS. `secure` mode = DoH only, no plaintext fallback. Override the
/// resolver with `RILLIO_DOH_TEMPLATE=<url>`, or disable with `=off` (e.g. if a
/// network blocks the DoH endpoint and breaks resolution). NOTE: DoH does not
/// hide your IP from torrent peers (that needs a VPN/proxy) — see
/// memory/compositing-dcomp-plan sibling notes.
fn browser_args() -> String {
    let base = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
    match std::env::var("RILLIO_DOH_TEMPLATE") {
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

    // Must run BEFORE any WebView2 initialization (i.e. before Builder::run),
    // otherwise the running WebView2 holds its own cache dirs open and they
    // cannot be deleted. Uses the context (available before .run()) for the
    // identifier + version.
    let ctx = tauri::generate_context!();
    clear_stale_webview_cache(
        ctx.config().identifier.clone(),
        ctx.package_info().version.to_string(),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(MpvState::default())
        .manage(shell::ShellState::default())
        .setup(|app| {
            start_streaming_server(app.handle());
            let window = build_main_window(app)?;
            spawn_update_check(app.handle().clone());
            // S3 part-2 render proof: RILLIO_MPV_TEST=<url|"test"> embeds mpv in
            // the window and plays it. "test" = a generated color pattern.
            if let Ok(src) = std::env::var("RILLIO_MPV_TEST") {
                if let Err(e) = start_mpv_embedded(app.handle(), &window, &src) {
                    tracing::error!("mpv embed test failed: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            install_update,
            shell::shell_init,
            shell::shell_send,
            shell::shell_mpv_stats
        ])
        .run(ctx)
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
/// Root fix for the "update installs but the UI is still the old one" bug: the
/// embedded web bundle registers a cache-first service worker, and its asset
/// path is prefixed with the commit hash, so after the native updater swaps in a
/// new bundle the stale SW + HTTP cache keep serving the OLD UI. Before the
/// WebView loads, if the shell's version changed since last run (fresh install
/// or a just-applied update), delete WebView2's service-worker + HTTP caches so
/// the fresh embedded assets always win. Best-effort: any error just logs and
/// the web-side self-heal (apps/web index.js) remains as a backstop.
fn clear_stale_webview_cache(identifier: String, current: String) {
    // %LOCALAPPDATA%\<identifier> is where WebView2 keeps its EBWebView profile.
    let local = match std::env::var_os("LOCALAPPDATA") {
        Some(dir) => dir,
        None => return,
    };
    let base = std::path::Path::new(&local).join(&identifier);
    let marker = base.join("web-bundle-version");
    // `current` is the tauri.conf.json version (bumped every release), not
    // Cargo.toml's CARGO_PKG_VERSION (a constant 0.1.0), so it changes on update.
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    if previous.trim() == current {
        return;
    }
    let default_profile = base.join("EBWebView").join("Default");
    for sub in ["Service Worker", "Cache", "Code Cache"] {
        let path = default_profile.join(sub);
        if !path.exists() {
            continue;
        }
        // std::fs::remove_dir_all refuses to traverse the reparse points inside
        // WebView2's cache dirs (os error 4395), so shell out to `rmdir /S /Q`,
        // which removes them the way Explorer/PowerShell do. Windows-only shell.
        #[cfg(windows)]
        let removed = std::process::Command::new("cmd")
            .args(["/C", "rmdir", "/S", "/Q"])
            .arg(&path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        #[cfg(not(windows))]
        let removed = std::fs::remove_dir_all(&path).is_ok();
        if removed && !path.exists() {
            tracing::info!("cache-clear: removed {}", path.display());
        } else {
            tracing::warn!("cache-clear: could not remove {}", path.display());
        }
    }
    let _ = std::fs::create_dir_all(&base);
    if let Err(e) = std::fs::write(&marker, &current) {
        tracing::warn!("cache-clear: could not write version marker: {e}");
    }
}

fn build_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    // In-window mpv compositing (S4) is opt-in behind RILLIO_EMBED_MPV: on
    // Windows a transparent (layered) top-level window does NOT display child
    // windows that render with the GPU, so mpv's gpu-next output embedded via
    // `wid` renders to an invisible surface. Until that's solved properly, the
    // default is a non-transparent window + mpv in its own output window (which
    // works). See mpv_embed_enabled().
    // RILLIO_START_URL overrides the initial page (debug hook — e.g. point it at
    // a DoH check page to verify DNS encryption is active).
    let start_url = std::env::var("RILLIO_START_URL")
        .ok()
        .and_then(|u| tauri::Url::parse(&u).ok())
        .map(tauri::WebviewUrl::External)
        .unwrap_or_default();
    let window = tauri::WebviewWindowBuilder::new(app, "main", start_url)
        .title("Rillio")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        // Frameless: the web app draws its own window controls + drag region
        // (apps/web WindowControls), gated to the shell. Edge-resize still works.
        .decorations(false)
        // Created hidden; the web loading screen calls window.show() once it has
        // painted (index.html), so the transparent window never flashes the
        // desktop through. A Rust fallback below reveals it if that never fires.
        .visible(false)
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
        .build()?;

    // Self-heal a stuck fullscreen state: if a previous session died while
    // fullscreen, the OS can restore the window fullscreen, which silently
    // disables resizing and Windows' drag-to-top (Aero snap) maximize. The app
    // always starts windowed; fullscreen is only entered via its header button.
    let _ = window.set_fullscreen(false);

    // Fallback reveal: if the web layer never calls show() (e.g. a startup error
    // before the loading screen paints), don't leave an invisible window. show()
    // is idempotent, so racing the JS path is harmless.
    let fallback = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let _ = fallback.show();
    });

    Ok(window)
}

/// On launch, ask GitHub Releases (see `plugins.updater.endpoints` in
/// tauri.conf.json) whether a newer signed build exists. If so, emit
/// `update-available` with the version so the web UI can surface a toast (see
/// apps/web ServicesToaster); the user installs it from there via
/// [`install_update`]. Runs on every startup, so the toast reappears until the
/// update is taken. Fails quietly: no release yet / offline / an unconfigured
/// signing key all just log at debug and leave the running app untouched.
fn spawn_update_check(app: tauri::AppHandle) {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(updater) => updater,
            // A missing/invalid pubkey surfaces here as Err, not a panic.
            Err(e) => {
                tracing::debug!("updater unavailable: {e}");
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                tracing::info!("update {} available", update.version);
                let _ = app.emit("update-available", update.version.clone());
            }
            Ok(None) => tracing::debug!("rillio is up to date"),
            Err(e) => tracing::debug!("update check failed: {e}"),
        }
    });
}

/// Download, verify (minisign) and install the pending update, then relaunch.
/// Invoked from the web UI's update toast. Re-checks so it never installs a
/// stale handle.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;

    // Stream download progress to the web UI's updating overlay
    // (apps/web App/UpdatingOverlay); `content_len` is the total size when known.
    let app_cb = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded += chunk_len as u64;
                let _ = app_cb.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": content_len }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // Diverges (never returns), so the Ok arm below is unreachable.
    app.restart()
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
