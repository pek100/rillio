//! S3 part 3 — the shell ⇄ web-client player bridge.
//!
//! The web client (`packages/video/src/ShellVideo`) drives a native mpv over a
//! tiny IPC: it sends `mpv-command` / `mpv-set-prop` / `mpv-observe-prop` and
//! listens for `mpv-prop-change` / `mpv-event-ended`. On desktop we carry that
//! IPC over Tauri: [`shell_send`] receives the outbound messages and drives
//! libmpv; a background event-loop thread emits the inbound ones as the Tauri
//! event `shell-signal`.
//!
//! Because mpv is a native HTTP client it fetches the streaming server's
//! `/{infohash}/{idx}` URL directly — no browser CORS/Private-Network preflight,
//! no HTML5 codec gate. That both starts the torrent download (our stream route
//! auto-creates the torrent on first byte-range) and decodes every codec
//! (HEVC/HDR/10-bit) that WebView2 cannot.
//!
//! Rendering note: this first cut lets mpv open its own output window (no `wid`
//! embedding) so the always-visible web UI keeps driving playback. Compositing
//! mpv *behind* a transparent WebView (single-window UX) is the S3 part-4
//! follow-up.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::mpv::{self, Mpv, MpvEvent};

/// Version the shell reports to the web client (mirrors the streaming server).
const SHELL_VERSION: &str = "5.0.0-rust";

/// Lazily-created native player. Held in Tauri state; `None` until the web
/// client first talks to the shell (on mount, via [`shell_init`]).
#[derive(Default)]
pub struct ShellState(Mutex<Option<Arc<Controller>>>);

/// A live mpv instance plus a cache of its latest property values.
struct Controller {
    mpv: Arc<Mpv>,
    /// Latest value of every observed mpv property, for the "Stats for nerds"
    /// panel (`shell_mpv_stats`). Updated by the event loop on every change.
    props: Mutex<serde_json::Map<String, Value>>,
}

/// Extra mpv properties (beyond what ShellVideo observes) that the stats panel
/// wants: codecs, bitrates, fps, hardware-decode status, container, geometry.
const STATS_PROPS: &[&str] = &[
    "video-codec",
    "video-format",
    "audio-codec",
    "audio-codec-name",
    "audio-params",
    "container-fps",
    "estimated-vf-fps",
    "video-bitrate",
    "audio-bitrate",
    "hwdec-current",
    "file-format",
    "width",
    "height",
];

/// High-frequency props whose forwarding to the web UI is rate-limited.
const HF_PROPS: &[&str] = &["time-pos", "demuxer-cache-time"];
/// Minimum spacing between forwarded high-frequency updates (~5/s).
const HF_INTERVAL: Duration = Duration::from_millis(200);

/// What [`shell_init`] returns to the web client's `useShell`.
#[derive(Serialize)]
pub struct ShellInit {
    version: String,
    #[serde(rename = "gpuVideoProcessing")]
    gpu_video_processing: bool,
    /// Whether native playback is available (libmpv loaded + initialized).
    ok: bool,
}

/// One inbound IPC signal, emitted as the Tauri event `shell-signal`. `event` is
/// the method name the web client listens for (`mpv-prop-change` /
/// `mpv-event-ended`); `payload` is its single argument.
#[derive(Serialize, Clone)]
struct ShellSignal {
    event: String,
    payload: Value,
}

impl ShellState {
    /// Get the controller, creating (and initializing mpv) on first use. Cheap
    /// after the first call. Errors if libmpv can't be loaded/initialized.
    fn ensure(&self, app: &AppHandle) -> Result<Arc<Controller>, String> {
        let mut guard = self.0.lock().unwrap();
        if let Some(ctrl) = guard.as_ref() {
            return Ok(ctrl.clone());
        }
        // Embed mpv into the main window (its HWND is the mpv `wid`) so video
        // renders inside the app instead of a separate top-level window. The web
        // UI, transparent during playback, overlays it. Falls back to a separate
        // mpv window if the HWND isn't available.
        let wid = main_window_wid(app);
        let ctrl = Arc::new(Controller::create(wid)?);
        spawn_event_loop(ctrl.clone(), app.clone());
        *guard = Some(ctrl.clone());
        tracing::info!("shell: native mpv player ready (wid={wid:?})");
        Ok(ctrl)
    }
}

/// The main window's native handle as an mpv `wid`, if in-window embedding is
/// enabled (Windows + `STREMIO_EMBED_MPV`). Otherwise `None` → mpv uses its own
/// output window (the working default; see `lib::mpv_embed_enabled`).
fn main_window_wid(app: &AppHandle) -> Option<isize> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if !crate::mpv_embed_enabled() {
            return None;
        }
        let window = app.get_webview_window("main")?;
        let hwnd = window.hwnd().ok()?;
        return Some(hwnd.0 as isize);
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

impl Controller {
    /// Load libmpv and initialize an idle instance ready for `loadfile`. When
    /// `wid` is set, mpv renders into that window handle (embedded); otherwise it
    /// opens its own output window.
    fn create(wid: Option<isize>) -> Result<Self, String> {
        let dll = mpv::default_dll_path();
        let mpv = Mpv::load(&dll)?;
        // `wid` must be set before initialize(): mpv creates its video output as
        // a child of this window rather than a standalone one.
        if let Some(wid) = wid {
            if let Err(e) = mpv.set_option("wid", &wid.to_string()) {
                tracing::warn!("mpv: could not set wid={wid}: {e} (falling back to own window)");
            }
        }
        // Stay alive across stop/eof so the same instance plays every title; the
        // web client sends `stop` then a later `loadfile`. No stray window at
        // startup — mpv opens its output window only once a file plays.
        //
        // Best-effort: a minimal libmpv build may lack some of these options
        // (e.g. `osc` needs the Lua OSC). A missing option must not sink the
        // whole player, so we log and continue rather than abort init.
        for (name, value) in [
            ("idle", "yes"),
            ("force-window", "no"),
            ("config", "no"), // ignore any on-machine mpv.conf
            ("terminal", "no"),
            ("osc", "no"), // the web UI is our on-screen controls
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            // Be patient with the loopback stream: on a fresh large title the
            // server holds the response while librqbit runs its initial checksum
            // pass (can be ~a minute). Default network-timeout (60s) could abort
            // the open; give generous headroom.
            ("network-timeout", "600"),
        ] {
            if let Err(e) = mpv.set_option(name, value) {
                tracing::warn!("mpv: option {name}={value} not applied: {e}");
            }
        }
        mpv.initialize()?;
        // Only surface mpv's own errors by default (verbose "v" floods the event
        // loop and lags the UI). Opt into verbose with STREMIO_MPV_VERBOSE.
        let log_level = if std::env::var("STREMIO_MPV_VERBOSE").is_ok() { "v" } else { "error" };
        if let Err(e) = mpv.request_log_messages(log_level) {
            tracing::warn!("mpv: request_log_messages failed: {e}");
        }
        // Observe the extra stats properties ShellVideo doesn't, so the panel can
        // show codec/bitrate/hwdec/etc. (Their changes flow through the same
        // event loop and land in `props`.)
        for name in STATS_PROPS {
            if let Err(e) = mpv.observe_property(name) {
                tracing::debug!("mpv: observe {name} failed: {e}");
            }
        }
        Ok(Self { mpv: Arc::new(mpv), props: Mutex::new(serde_json::Map::new()) })
    }
}

/// The event-loop thread: block on mpv events and forward the ones the web
/// client cares about as `shell-signal`. Runs for the app's lifetime.
fn spawn_event_loop(ctrl: Arc<Controller>, app: AppHandle) {
    let mpv = ctrl.mpv.clone();
    std::thread::Builder::new()
        .name("mpv-events".into())
        .spawn(move || {
            // Whether we've pushed the embedded mpv child behind the WebView for
            // the current playback (mpv creates its output window on the first
            // frame; do it once video-params arrive).
            let mut composited = false;
            // Rate-limit high-frequency props (mpv fires time-pos/cache-time
            // many×/s); each emit is an IPC hop + React update, so throttle to
            // keep the UI responsive. The web player caps its own time to 1/s.
            let mut last_hf: HashMap<&'static str, Instant> = HashMap::new();
            loop {
            match mpv.wait_event(-1.0) {
                MpvEvent::Shutdown => break,
                MpvEvent::LogMessage { prefix, level, text } => {
                    tracing::debug!("mpv[{level}] {prefix}: {text}");
                }
                MpvEvent::PropertyChange { name, value } => {
                    // Cache the latest value for the stats panel.
                    ctrl.props.lock().unwrap().insert(name.clone(), value.clone());
                    // High-signal, low-noise props at debug (skip the per-frame ones).
                    if !matches!(name.as_str(), "time-pos" | "demuxer-cache-time") {
                        tracing::debug!("mpv prop {name} = {value}");
                    }
                    // Once the video output exists, drop it behind the WebView so
                    // the (transparent-during-playback) web UI overlays it. Only
                    // when in-window embedding is enabled (S4).
                    if name == "video-params" && value.is_object() && !composited {
                        if crate::mpv_embed_enabled() {
                            composite_behind_webview(&app);
                        }
                        composited = true;
                    }
                    if name == "video-params" && value.is_null() {
                        composited = false; // unloaded; re-composite on next file
                    }
                    // Stats-only props (our extra observes) are read by the panel
                    // via `shell_mpv_stats`; don't forward them to the web player
                    // — some update per-frame and would flood the UI event stream.
                    let mut forward = !STATS_PROPS.contains(&name.as_str());
                    if forward {
                        if let Some(key) = HF_PROPS.iter().find(|k| **k == name.as_str()) {
                            let now = Instant::now();
                            match last_hf.get(key) {
                                Some(t) if now.duration_since(*t) < HF_INTERVAL => forward = false,
                                _ => { last_hf.insert(key, now); }
                            }
                        }
                    }
                    if forward {
                        emit(
                            &app,
                            "mpv-prop-change",
                            serde_json::json!({ "name": name, "data": value }),
                        );
                    }
                }
                MpvEvent::EndFile { reason, error } => {
                    tracing::debug!("mpv end-file: reason={reason} error={error}");
                    // mpv_end_file_reason: 0 eof, 2 stop, 3 quit, 4 error, 5 redirect.
                    let reason_str = match reason {
                        0 => "eof",
                        2 => "stop",
                        3 => "quit",
                        4 => "error",
                        5 => "redirect",
                        _ => "other",
                    };
                    let err = if error < 0 {
                        Value::String(mpv.error_string(error))
                    } else {
                        Value::Null
                    };
                    emit(
                        &app,
                        "mpv-event-ended",
                        serde_json::json!({ "reason": reason_str, "error": err }),
                    );
                }
                MpvEvent::Other => {}
            }
            }
        })
        .expect("spawn mpv-events thread");
}

/// Push mpv's embedded video child window to the bottom of the main window's
/// z-order, so the (transparent-during-playback) WebView renders on top and its
/// controls overlay the video. mpv registers its output window with class "mpv"
/// as a child of the `wid` we gave it.
#[cfg(windows)]
fn composite_behind_webview(app: &AppHandle) {
    use tauri::Manager;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE,
    };

    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(hwnd) = window.hwnd() else { return };

    unsafe extern "system" fn enum_cb(child: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 32];
        let len = unsafe { GetClassNameW(child, &mut buf) };
        if len > 0 {
            let class = String::from_utf16_lossy(&buf[..len as usize]);
            if class == "mpv" {
                let _ = unsafe {
                    SetWindowPos(
                        child,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    )
                };
            }
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumChildWindows(Some(HWND(hwnd.0 as *mut _)), Some(enum_cb), LPARAM(0));
    }
    tracing::debug!("shell: composited mpv behind WebView");
}

#[cfg(not(windows))]
fn composite_behind_webview(_app: &AppHandle) {}

fn emit(app: &AppHandle, event: &str, payload: Value) {
    if let Err(e) = app.emit("shell-signal", ShellSignal { event: event.into(), payload }) {
        tracing::warn!("shell: emit {event} failed: {e}");
    }
}

/// Handshake: called once when the web client's `useShell` mounts. Creates the
/// native player and reports the shell version + capabilities. `ok=false` (mpv
/// unavailable) tells the web client to fall back to the in-WebView player.
#[tauri::command]
pub fn shell_init(app: AppHandle, state: State<ShellState>) -> ShellInit {
    let ok = match state.ensure(&app) {
        Ok(_) => true,
        Err(e) => {
            tracing::error!("shell_init: native player unavailable: {e}");
            false
        }
    };
    ShellInit { version: SHELL_VERSION.into(), gpu_video_processing: false, ok }
}

/// Snapshot of mpv's current media properties for the "Stats for nerds" panel:
/// codec/resolution/HDR/bit-depth/fps/bitrate/hwdec (video) and
/// codec/channels/sample-rate/bitrate (audio). Polled ~1×/s while the panel is
/// open. Values are whatever mpv last reported (some are null until playback).
#[tauri::command]
pub fn shell_mpv_stats(app: AppHandle, state: State<ShellState>) -> Value {
    match state.ensure(&app) {
        Ok(ctrl) => Value::Object(ctrl.props.lock().unwrap().clone()),
        Err(_) => Value::Object(serde_json::Map::new()),
    }
}

/// Carry one outbound IPC message to mpv. `args` is the web client's argument
/// list; each method takes a single argument at `args[0]` (an array for
/// commands/prop-sets, a string for prop-observes, a bool for the gpu toggle).
#[tauri::command]
pub fn shell_send(
    app: AppHandle,
    state: State<ShellState>,
    method: String,
    args: Vec<Value>,
) -> Result<(), String> {
    let ctrl = state.ensure(&app)?;
    let arg0 = args.first().cloned().unwrap_or(Value::Null);
    match method.as_str() {
        "mpv-command" => {
            let list = arg0.as_array().ok_or("mpv-command: expected an array")?;
            let strs: Vec<String> = list.iter().map(json_to_mpv_str).collect();
            let refs: Vec<&str> = strs.iter().map(String::as_str).collect();
            tracing::debug!("mpv command {refs:?}");
            // Drop cached stats when playback stops so the panel doesn't show a
            // previous title's codec/bitrate.
            if refs.first() == Some(&"stop") {
                ctrl.props.lock().unwrap().clear();
            }
            // Normalize `loadfile`. The web client appends a positional
            // `replace`/index/`start=+N` (resume time) form whose exact shape
            // depends on its mpv-version guess; this libmpv build misparses it
            // ("loadfile option must be an integer: start=+90") and the load
            // fails, so nothing ever streams. Apply the resume time via the
            // `start` property and issue a clean two-arg loadfile instead.
            if refs.first() == Some(&"loadfile") {
                let url = refs.get(1).copied().unwrap_or_default();
                let start = refs
                    .iter()
                    .find_map(|a| a.strip_prefix("start=+").or_else(|| a.strip_prefix("start=")));
                // Reset to "none" for fresh plays so a prior resume point doesn't
                // leak into the next title.
                let _ = ctrl.mpv.set_property("start", start.unwrap_or("none"));
                tracing::debug!("mpv loadfile url={url} start={start:?}");
                return ctrl.mpv.command(&["loadfile", url, "replace"]);
            }
            ctrl.mpv.command(&refs)
        }
        "mpv-set-prop" => {
            let list = arg0.as_array().ok_or("mpv-set-prop: expected [name, value]")?;
            let name = list
                .first()
                .and_then(Value::as_str)
                .ok_or("mpv-set-prop: missing property name")?;
            let value = json_to_mpv_str(list.get(1).unwrap_or(&Value::Null));
            tracing::debug!("mpv set-prop {name} = {value}");
            if let Err(e) = ctrl.mpv.set_property(name, &value) {
                // A minimal build may reject a prop (e.g. vo=gpu-next); log but
                // don't fail the whole load sequence.
                tracing::warn!("mpv set-prop {name}={value} failed: {e}");
            }
            Ok(())
        }
        "mpv-observe-prop" => {
            let name = arg0.as_str().ok_or("mpv-observe-prop: expected a name")?;
            // ALWAYS observe — never de-dupe. The web client builds a fresh
            // ShellVideo per playback and relies on mpv re-emitting each
            // property's initial value; `mpv-version` in particular gates the
            // `loadfile` (waitForMPVVersion). De-duping made the 2nd+ playback in
            // a session never receive mpv-version → loadfile never fired → the
            // title silently "wouldn't resume/play". (mpv fires an initial value
            // per observe registration; duplicates are cheap and HF props are
            // throttled downstream.)
            ctrl.mpv.observe_property(name)
        }
        // GPU video processing (mpv shaders) — not wired yet; accept silently so
        // the web client's load sequence isn't interrupted.
        "mpv-set-gpu-video-processing" => Ok(()),
        // Fullscreen: the web player drives it through the shell when active
        // (FullscreenProvider). Toggle the native window and echo the state back
        // as `win-visibility-changed` so the UI updates (and can exit again).
        "win-set-visibility" => {
            use tauri::Manager;
            let fullscreen = arg0.get("fullscreen").and_then(Value::as_bool).unwrap_or(false);
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.set_fullscreen(fullscreen) {
                    tracing::warn!("shell: set_fullscreen({fullscreen}) failed: {e}");
                }
            }
            emit(
                &app,
                "win-visibility-changed",
                serde_json::json!({ "visible": true, "visibility": 1, "isFullscreen": fullscreen }),
            );
            Ok(())
        }
        other => {
            tracing::debug!("shell_send: unhandled method {other}");
            Ok(())
        }
    }
}

/// Render a JSON argument the way mpv's string setters expect: booleans as
/// `yes`/`no`, numbers as their decimal text, strings verbatim, null as empty.
fn json_to_mpv_str(v: &Value) -> String {
    match v {
        Value::Bool(b) => if *b { "yes" } else { "no" }.to_string(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
