//! Rillio desktop shell (Tauri v2).
//!
//! S0: a WebView2 window hosting the `apps/web` client.
//! S1: the Rust streaming server runs in-process (no container/sidecar) - the
//! web client reaches it at http://127.0.0.1:11470 exactly as before.

pub mod mpv;
mod shell;

use std::sync::Mutex;

use tauri::Manager;

/// The embedded mpv instance (S3). `None` until playback starts.
#[derive(Default)]
struct MpvState(Mutex<Option<mpv::Mpv>>);

/// Set while [`install_update`] is tearing the webview down to run the
/// installer. Destroying the last window fires `RunEvent::ExitRequested`
/// (code None), which must NOT exit the app then: the update task still has to
/// wait for WebView2 to release the profile and hand off to the installer.
#[derive(Default)]
struct UpdateInFlight(std::sync::atomic::AtomicBool);

/// Buffer for OS deep links (stremio:// / rillio://). A link can arrive before
/// the WebView has mounted its listener (cold start: the app is launched BY the
/// link) or while the app is already running (warm: forwarded by the
/// single-instance + deep-link plugin integration). We forward each URL to the
/// web client as the `deep-link-open` signal; until the web reports it is ready
/// (`app-ready` over the shell bridge) we buffer them so a cold-start link is
/// not dropped on the floor.
#[derive(Default)]
struct DeepLinkQueue {
    web_ready: bool,
    pending: Vec<String>,
}

#[derive(Default)]
struct DeepLinkState(Mutex<DeepLinkQueue>);

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
/// hide your IP from torrent peers (that needs a VPN/proxy) - see
/// memory/compositing-dcomp-plan sibling notes.
fn browser_args() -> String {
    let base = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
    let dns = match std::env::var("RILLIO_DOH_TEMPLATE") {
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("off") => base.to_string(),
        Ok(v) if !v.trim().is_empty() => {
            format!("{base} --dns-over-https-mode=secure --dns-over-https-templates={}", v.trim())
        }
        _ => format!(
            "{base} --dns-over-https-mode=secure --dns-over-https-templates=https://cloudflare-dns.com/dns-query"
        ),
    };
    // Debug knob: opens a CDP endpoint on the WebView so the running shell's real
    // DOM/console can be inspected from outside. The shell's own DOM is the only
    // way to settle bugs that reproduce here but not in a browser. OFF unless the
    // env var is set: an open CDP port is local code execution in the page.
    match std::env::var("RILLIO_DEVTOOLS_PORT") {
        Ok(p) if !p.trim().is_empty() => format!("{dns} --remote-debugging-port={}", p.trim()),
        _ => dns,
    }
}

/// Schemes the shell will hand to the OS default handler (S2). This is a strict
/// allowlist: `open::that` is a shell-execute, so passing an arbitrary
/// webview-supplied string would let addon-driven content launch local programs
/// (`file:///C:/...exe`, a UNC `\\server\share\x.exe`, or any registered
/// protocol handler like `ms-msdt:`). Only the schemes the web client's
/// `openExternal` and custom-scheme navigations legitimately produce are
/// allowed; everything else is refused.
///
/// Inventory (evidence): `apps/web` calls `platform.openExternal` with http/https
/// (addon configure, addon directory, Trakt/Facebook/Apple login, password reset,
/// calendar .ics, data export, stream download + subtitle URLs) and `webcal`
/// (iOS calendar, Settings/General). `magnet:` and the external-player deep-link
/// schemes come from `crates/core/src/deep_links` (ExternalPlayerLink /
/// OpenPlayerLink): mpv, iina, infuse, vidhub, outplayer, moonplayer, VLC's
/// x-callback and android `intent://`. `mailto:` is a standard safe handoff.
/// (On the Windows shell only http/https/magnet are exercised today; the rest
/// keep the cross-platform openExternal contract intact and fail closed.)
fn is_allowed_external_scheme(scheme: &str) -> bool {
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "http"
            | "https"
            | "magnet"
            | "mailto"
            | "webcal"
            // external media players (crates/core deep_links)
            | "mpv"
            | "iina"
            | "infuse"
            | "open-vidhub"
            | "outplayer"
            | "moonplayer"
            | "vlc-x-callback"
            | "intent"
    )
}

/// Validate a raw external-open URL: it must parse as an absolute URL and carry
/// an allowed scheme. Fails CLOSED, a string that does not parse (schemeless /
/// relative paths, a bare `C:\...` path, or a `\\server\share` UNC path) is
/// refused rather than passed to the OS.
fn validate_external_url(url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url)
        .map_err(|e| format!("open_external: refusing unparseable url {url:?}: {e}"))?;
    if is_allowed_external_scheme(parsed.scheme()) {
        Ok(())
    } else {
        Err(format!(
            "open_external: refusing disallowed scheme {:?} ({url:?})",
            parsed.scheme()
        ))
    }
}

/// Open a URL in the OS default handler / native app (S2).
///
/// This is the desktop implementation of the web client's
/// `platform.openExternal`. Running in the trusted shell, it opens the target
/// directly (external player, torrent client, browser) instead of the browser's
/// `window.open` + safety-warning redirect. The scheme is checked against
/// [`is_allowed_external_scheme`] first so hostile webview content cannot use
/// this to shell-execute a local file or an arbitrary protocol handler.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    open::that(&url).map_err(|e| format!("open_external({url}): {e}"))
}

/// The only schemes we accept from the OS. The deep-link plugin is configured
/// for exactly these (see tauri.conf.json), but deep links are untrusted input,
/// so we re-check the scheme at the boundary before forwarding anything.
fn is_deep_link_scheme(scheme: &str) -> bool {
    matches!(scheme.to_ascii_lowercase().as_str(), "stremio" | "rillio")
}

/// Forward one deep-link URL to the web client. We reuse the existing shell
/// signal bus (`shell-signal` carries `{event, payload}`; useShell re-emits it
/// as the named event), so the web listens with `shell.on('deep-link-open')`.
/// The web side (DeepLinkOpenHandler) validates + routes it.
fn emit_deep_link(app: &tauri::AppHandle, url: &str) {
    use tauri::Emitter;
    if let Err(e) = app.emit(
        "shell-signal",
        serde_json::json!({ "event": "deep-link-open", "payload": url }),
    ) {
        tracing::warn!("deep-link: emit failed for {url}: {e}");
    }
}

/// Accept a deep link from the OS: emit it now if the web client is ready,
/// otherwise buffer it until `app-ready`. The scheme is assumed pre-checked by
/// the caller (via [`is_deep_link_scheme`]).
fn queue_or_emit_deep_link(app: &tauri::AppHandle, url: &str) {
    let ready = {
        let state = app.state::<DeepLinkState>();
        let mut q = state.0.lock().unwrap();
        if q.web_ready {
            true
        } else {
            tracing::info!("deep-link: buffering {url} until web is ready");
            q.pending.push(url.to_string());
            false
        }
    };
    if ready {
        tracing::info!("deep-link: forwarding {url}");
        emit_deep_link(app, url);
    }
}

/// Called when the web client reports it has mounted its listeners (`app-ready`
/// over the shell bridge, see `shell::shell_send`). Marks the web ready and
/// flushes any deep links that arrived during startup.
pub(crate) fn mark_web_ready_and_flush(app: &tauri::AppHandle) {
    let pending: Vec<String> = {
        let state = app.state::<DeepLinkState>();
        let mut q = state.0.lock().unwrap();
        q.web_ready = true;
        std::mem::take(&mut q.pending)
    };
    for url in pending {
        tracing::info!("deep-link: flushing buffered {url}");
        emit_deep_link(app, &url);
    }
}

/// Register the OS-deep-link handlers. `get_current()` captures a cold-start
/// launch URL (the app was opened BY the link); `on_open_url` fires for links
/// opened while running (delivered here by the single-instance `deep-link`
/// integration on Windows). Both funnel through [`queue_or_emit_deep_link`].
///
/// NOTE: we deliberately do NOT call `register_all()` here. That writes the
/// scheme handlers into the Windows registry at runtime, which would hijack the
/// machine's real `stremio://` handler to point at a dev build. Production
/// registration is done by the NSIS installer from the `plugins.deep-link`
/// config in tauri.conf.json.
fn setup_deep_links(app: &tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;

    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            if is_deep_link_scheme(url.scheme()) {
                queue_or_emit_deep_link(app.handle(), url.as_str());
            }
        }
    }

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if is_deep_link_scheme(url.scheme()) {
                queue_or_emit_deep_link(&handle, url.as_str());
            } else {
                tracing::warn!("deep-link: ignoring non-stremio/rillio url {url}");
            }
        }
    });
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
        // Single-instance MUST be the first plugin registered (Tauri requirement).
        // On a second launch, focus the running window instead of starting a
        // second shell that would fail to bind :11470 and clobber the WebView2
        // profile the first one is using.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Deep-link plugin MUST be registered after single-instance (above) so
        // the single-instance `deep-link` feature can forward a warm-launch URL
        // into this plugin's on_open_url. See setup_deep_links.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(MpvState::default())
        .manage(UpdateInFlight::default())
        .manage(shell::ShellState::default())
        .manage(DeepLinkState::default())
        .setup(|app| {
            start_streaming_server(app.handle());
            let window = build_main_window(app)?;
            spawn_update_check(app.handle().clone());
            setup_deep_links(app);
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
            shell::shell_mpv_stats,
            shell::player_snapshot,
            shell::player_blur_rect
        ])
        .build(ctx)
        .expect("error while building the Rillio desktop shell")
        // The run callback exists for exactly one reason: during an update,
        // install_update destroys the main window BEFORE running the installer
        // (see the incident note there), and destroying the last window
        // requests an exit (code None). Exiting then would kill the update
        // task mid-handoff, so it is prevented while UpdateInFlight is set.
        // Programmatic exits (code Some, e.g. app.restart()) always proceed.
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                let updating = app_handle
                    .state::<UpdateInFlight>()
                    .0
                    .load(std::sync::atomic::Ordering::SeqCst);
                if code.is_none() && updating {
                    api.prevent_exit();
                }
            }
        });
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
///
/// INCIDENT NOTE (2026-07-13): when the 0.1.16 -> 0.1.17 update wiped a user's
/// profile/library, this function was the first suspect and was proven INNOCENT
/// (the real cause was the updater's hard process exit, see install_update).
/// Keep it innocent: ALL user data lives in this same profile ("Local Storage"
/// is the only copy of profile/library/settings; also "IndexedDB",
/// "WebStorage", "Session Storage"). NEVER add a user-data directory to the
/// list below, and never delete `Default` or `EBWebView` wholesale. The three
/// entries below are pure caches and are the ONLY safe deletions.
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
    // NOTE: this dir list is duplicated in CLAUDE.md's dev-loop cache-clear
    // snippet ("Service Worker", "Cache", "Code Cache"); keep both in sync.
    let mut all_cleared = true;
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
            all_cleared = false;
            tracing::warn!("cache-clear: could not remove {}", path.display());
        }
    }
    // Only advance the version marker once the stale caches are actually gone. If
    // any removal failed, leave the marker unwritten so the next launch retries
    // the clear, writing it now would strand a half-deleted cache serving the old
    // bundle forever.
    if !all_cleared {
        tracing::warn!(
            "cache-clear: INCOMPLETE for version {current}; leaving marker unwritten to retry next launch"
        );
        return;
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
    // RILLIO_START_URL overrides the initial page (debug hook - e.g. point it at
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
                // In-WebView navigations (app pages, data/blob assets).
                "http" | "https" | "tauri" | "data" | "blob" | "about" => true,
                // A custom-scheme link (external player, magnet, ...). Hand it to
                // the OS ONLY if the scheme is allowlisted; otherwise block it so
                // a file:/unknown-protocol link in addon content cannot
                // shell-execute a local program. Never navigate the WebView to it.
                scheme => {
                    if is_allowed_external_scheme(scheme) {
                        if let Err(e) = open::that(url.as_str()) {
                            tracing::error!("failed to open external {url}: {e}");
                        }
                    } else {
                        tracing::warn!("blocked navigation to disallowed scheme {scheme:?}: {url}");
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
///
/// INCIDENT (2026-07-13, the 0.1.16 -> 0.1.17 auto-update WIPED a user's
/// profile/library/settings): tauri-plugin-updater's install step launches the
/// NSIS installer and then calls `std::process::exit(0)` immediately, with the
/// WebView2 child processes still alive and possibly mid-write. The abandoned
/// browser process then shuts down asynchronously, racing the installer and the
/// relaunched app over the EBWebView profile; Chromium "recovered" the profile's
/// Local Storage leveldb (the ONLY copy of all user data, see
/// crates/core-web env.rs local_storage_*) by destroying and recreating it
/// EMPTY. Forensics: leveldb LOG showed the db reopening as a fresh generation
/// ("Recovering log #3") while orphaned old-generation tables (000140-000144)
/// survived only because their handles were still open when the destroy ran.
///
/// The fix: download first, then DESTROY the webview window (graceful WebView2
/// shutdown -> storage service flushes and exits) and WAIT until the browser
/// releases the Local Storage lock, and only then hand off to the installer.
/// The webview must never be alive when the process exits for an update.
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
    let bytes = update
        .download(
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

    // From here on the webview goes away, so this command's JS response will
    // never be delivered - that's fine, the next thing the user sees is the
    // updated app relaunching (NSIS passive mode relaunches it).
    app.state::<UpdateInFlight>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.destroy() {
            tracing::warn!("update: could not destroy the main window: {e}");
        }
    }
    let identifier = app.config().identifier.clone();
    let released =
        tauri::async_runtime::spawn_blocking(move || wait_for_webview_profile_release(&identifier))
            .await
            .unwrap_or(false);
    if !released {
        // Fail loud but proceed: blocking the update forever on a wedged
        // browser process would strand the user on the old version, and the
        // destroyed window already stopped all new writes.
        tracing::warn!("update: WebView2 did not release the profile in time, installing anyway");
    }

    // Hands off to the installer and exits this process, so this normally
    // never returns.
    if let Err(e) = update.install(bytes) {
        // The webview is already gone: without a relaunch this process would be
        // a headless zombie. Restart the (still old) app; the update toast will
        // re-offer the update on the next launch.
        tracing::error!("update: install failed, relaunching the current version: {e}");
        app.restart();
    }
    Ok(())
}

/// Wait (up to 10s) for the WebView2 browser process to shut down and release
/// this app's Local Storage database. Chromium holds the leveldb `LOCK` file
/// open with no sharing, so an exclusive open attempt fails with a sharing
/// violation exactly as long as the storage service is still alive. Returns
/// true once the lock is free (or never existed).
#[cfg(windows)]
fn wait_for_webview_profile_release(identifier: &str) -> bool {
    use std::os::windows::fs::OpenOptionsExt;

    let local = match std::env::var_os("LOCALAPPDATA") {
        Some(dir) => dir,
        None => return true,
    };
    let lock = std::path::Path::new(&local)
        .join(identifier)
        .join("EBWebView")
        .join("Default")
        .join("Local Storage")
        .join("leveldb")
        .join("LOCK");
    if !lock.exists() {
        return true;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        match std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0) // exclusive: fails while ANY other handle is open
            .open(&lock)
        {
            Ok(_) => {
                // Small grace period for the rest of the browser teardown.
                std::thread::sleep(std::time::Duration::from_millis(200));
                return true;
            }
            Err(e) => {
                if std::time::Instant::now() >= deadline {
                    tracing::warn!("webview profile still locked after 10s: {e}");
                    return false;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
}

#[cfg(not(windows))]
fn wait_for_webview_profile_release(_identifier: &str) -> bool {
    true
}

/// True when we can create `dir` and write a file inside it.
fn dir_writable(dir: &std::path::Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The torrent cache root. The cache lives IN THE APP'S FOLDER (`<app>\cache`):
/// the user already chose where the app lives via the installer's directory
/// picker, so the (potentially huge) cache inherits that choice instead of
/// silently filling the system drive's appdata. The one place that can't work
/// is a non-writable install dir (e.g. an elevated install under Program
/// Files), where we fall back to the app data dir and say so in the log.
fn default_cache_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(app_dir) = exe.parent() {
            let cache = app_dir.join("cache");
            if dir_writable(&cache) {
                return cache;
            }
            tracing::warn!(
                "cache dir {cache:?} is not writable, falling back to the app data dir"
            );
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("streaming-server")
}

/// One-time migration from the pre-0.1.17 cache location (appdata) to the
/// in-app-folder default. Same volume: a rename, instant regardless of size.
/// Cross volume: keep using the legacy dir instead (grandfathered) - silently
/// copying hundreds of GB at startup or abandoning the data are both worse.
/// Returns the cache root to actually use.
///
/// CRITICAL detail: librqbit's `session/session.json` stores each torrent's
/// `output_folder` as an ABSOLUTE path. After a move those still point at the
/// legacy root, and the engine happily keeps downloading THERE (recreating the
/// old dir on the old drive). Verified live 2026-07-12: a moved cache without
/// the rewrite re-downloaded ~30 GB onto the full system drive. So after a
/// successful move the session file gets its prefixes rewritten.
fn migrate_legacy_cache(legacy: &std::path::Path, new_root: &std::path::Path) -> bool {
    let has_content = |d: &std::path::Path| {
        d.read_dir().map(|mut i| i.next().is_some()).unwrap_or(false)
    };
    if !has_content(legacy) {
        return true; // nothing to migrate
    }
    if has_content(new_root) {
        // Both populated (e.g. a failed half-migration): prefer the new root,
        // and say loudly that the legacy data is orphaned.
        tracing::warn!(
            "both {legacy:?} and {new_root:?} contain cache data; using the new root. Delete the legacy dir to reclaim space."
        );
        return true;
    }
    // fs::rename moves a directory instantly on the same volume and fails
    // cross-volume (or while files are open) - exactly the split we want.
    let _ = std::fs::remove_dir(new_root); // rename target must not exist
    match std::fs::rename(legacy, new_root) {
        Ok(()) => {
            rewrite_session_output_folders(new_root, legacy, new_root);
            tracing::info!("migrated torrent cache {legacy:?} -> {new_root:?}");
            true
        }
        Err(e) => {
            tracing::info!(
                "cache stays at {legacy:?} (move to {new_root:?} not possible: {e})"
            );
            false
        }
    }
}

/// Rebase absolute `output_folder` paths inside librqbit's session.json from
/// `old_root` to `new_root`. Best-effort: a malformed or missing session file
/// is left alone (librqbit will rebuild it), but a rewrite failure after a
/// successful data move is loud, because the engine would then re-download to
/// the old location.
fn rewrite_session_output_folders(
    cache_root: &std::path::Path,
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) {
    let session = cache_root.join("session").join("session.json");
    let raw = match std::fs::read_to_string(&session) {
        Ok(raw) => raw,
        Err(_) => return, // no session yet - nothing to rewrite
    };
    let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        tracing::warn!("session.json is not valid JSON, leaving it untouched");
        return;
    };
    let (old_s, new_s) = (old_root.to_string_lossy(), new_root.to_string_lossy());
    let mut changed = false;
    if let Some(torrents) = json.get_mut("torrents").and_then(|t| t.as_object_mut()) {
        for torrent in torrents.values_mut() {
            if let Some(folder) = torrent.get_mut("output_folder") {
                if let Some(path) = folder.as_str() {
                    if path.starts_with(old_s.as_ref()) {
                        *folder = serde_json::Value::String(path.replacen(old_s.as_ref(), new_s.as_ref(), 1));
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        match serde_json::to_string(&json) {
            Ok(out) => {
                if let Err(e) = std::fs::write(&session, out) {
                    tracing::error!("session.json rewrite failed ({e}): torrents will keep downloading to {old_root:?}");
                }
            }
            Err(e) => tracing::error!("session.json re-serialize failed: {e}"),
        }
    }
}

/// Spawn the embedded streaming server on Tauri's async (tokio) runtime. It
/// binds 127.0.0.1:11470 and owns the torrent cache (see `default_cache_dir`).
fn start_streaming_server(app: &tauri::AppHandle) {
    // RILLIO_STREAMING_CACHE_DIR overrides the cache/session root. Use it to run
    // a dev build against an ISOLATED cache so it never opens (or evicts from) the
    // installed app's real torrent cache. Unset => `<app>\cache`.
    let mut cache_dir = match std::env::var_os("RILLIO_STREAMING_CACHE_DIR") {
        Some(dir) => std::path::PathBuf::from(dir),
        None => {
            let new_root = default_cache_dir(app);
            match app.path().app_data_dir().map(|d| d.join("streaming-server")) {
                Ok(legacy) if legacy != new_root => {
                    if migrate_legacy_cache(&legacy, &new_root) {
                        new_root
                    } else {
                        legacy // cross-volume: grandfathered in place
                    }
                }
                _ => new_root,
            }
        }
    };
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        tracing::error!("cannot create cache dir {cache_dir:?}: {e}");
        // Last-ditch so the server can still come up.
        cache_dir = std::env::temp_dir().join("rillio-streaming-server");
        let _ = std::fs::create_dir_all(&cache_dir);
    }
    let config = rillio_streaming_server::Config::local(cache_dir);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = rillio_streaming_server::serve(config).await {
            let msg = e.to_string();
            tracing::error!("embedded streaming server exited: {msg}");
            // Contract: the web app listens for the Tauri event
            // "streaming-server-error" (payload: the error string) so it can toast
            // that the local streaming server failed, e.g. a bind failure because
            // port 11470 is already taken. Without this the failure is only logged
            // and invisible to the user. The web-side listener is out of scope.
            use tauri::Emitter;
            let _ = app_handle.emit("streaming-server-error", msg);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every scheme the web client's openExternal / custom-scheme navigations
    /// legitimately produce must be accepted (parsed end-to-end).
    #[test]
    fn allows_legit_external_urls() {
        for url in [
            "http://127.0.0.1:11470/abc/0",
            "https://www.strem.io/trakt/auth/x",
            "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
            "mailto:support@rillio.app",
            "webcal://www.strem.io/calendar/x.ics",
            "vlc-x-callback://x-callback-url/stream?url=http%3A%2F%2Fx",
            "intent://x#Intent;scheme=https;end",
        ] {
            validate_external_url(url)
                .unwrap_or_else(|e| panic!("{url} should be allowed: {e}"));
        }
    }

    /// The S2 hole: file:, UNC / bare local paths, and unknown (possibly
    /// registered) protocols must all be refused before reaching `open::that`.
    #[test]
    fn rejects_file_unc_and_unknown_urls() {
        for bad in [
            "",                                     // empty / unparseable
            "file:///C:/Windows/System32/calc.exe", // file: scheme
            "C:/Windows/System32/calc.exe",         // bare drive path (scheme "c")
            "C:\\Windows\\System32\\calc.exe",
            "\\\\server\\share\\evil.exe",          // UNC, no scheme -> parse fails
            "//server/share",                       // schemeless / relative
            "made-up-scheme://whatever",            // unknown protocol handler
            "ms-msdt:/id",                          // classic Windows URL-handler RCE
            "javascript:alert(1)",
        ] {
            assert!(validate_external_url(bad).is_err(), "should reject {bad:?}");
        }
    }

    /// The deep-link scheme boundary accepts only stremio/rillio (any case) and
    /// denies everything else, so an OS-supplied URL of another scheme is never
    /// forwarded to the web client.
    #[test]
    fn deep_link_scheme_is_allowlisted() {
        for ok in ["stremio", "rillio", "STREMIO", "Rillio"] {
            assert!(is_deep_link_scheme(ok), "should accept {ok}");
        }
        for bad in ["", "http", "https", "magnet", "file", "javascript", "ms-msdt"] {
            assert!(!is_deep_link_scheme(bad), "should reject {bad}");
        }
    }

    /// The scheme check is case-insensitive and denies by default.
    #[test]
    fn scheme_check_is_case_insensitive_and_denies_by_default() {
        assert!(is_allowed_external_scheme("HTTPS"));
        assert!(is_allowed_external_scheme("Magnet"));
        assert!(is_allowed_external_scheme("mpv"));
        assert!(!is_allowed_external_scheme(""));
        assert!(!is_allowed_external_scheme("file"));
        assert!(!is_allowed_external_scheme("smb"));
    }
}
