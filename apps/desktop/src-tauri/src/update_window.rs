//! The custom update window (docs/update-window/decomposition.md): a DETACHED
//! `rillio-desktop --update-window` process showing update.html (liquid
//! composition + progress) while an update downloads and installs, replacing
//! the stock NSIS progress dialog.
//!
//! Why a separate process: tauri-plugin-updater exits this process the moment
//! it hands off to the installer, so an in-process window could only cover the
//! download. And why a separate WebView2 data directory: the updater's
//! data-wipe fix (`wait_for_webview_profile_release` in lib.rs, the 0.1.17
//! incident) waits for the MAIN profile's Local Storage lock to be released -
//! a window on the same profile would hold that lock and time the wait out.
//!
//! IPC is a tiny JSON file in the temp dir (`progress_path`): `install_update`
//! writes phases/bytes, this process polls it and drives the page. The
//! relaunched (new) app deletes the file on boot - that deletion, observed
//! while in the `installing` phase, is the "update done" signal.

use std::io::Write;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    pub phase: String, // downloading | installing | error
    #[serde(default)]
    pub downloaded: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// The progress file both processes agree on. Temp dir, not the app config dir:
/// it must be writable before install and irrelevant after (the new app boot
/// deletes it; a leftover from a crashed run is harmless and overwritten).
pub fn progress_path() -> std::path::PathBuf {
    std::env::temp_dir().join("rillio-update-progress.json")
}

/// Atomically-enough write (temp + rename would be overkill for a single small
/// line read by a tolerant poller; a torn read just shows the previous frame).
pub fn write_progress(progress: &UpdateProgress) {
    if let Ok(json) = serde_json::to_string(progress) {
        let _ = std::fs::File::create(progress_path()).and_then(|mut f| f.write_all(json.as_bytes()));
    }
}

/// Spawn the detached update-window process (the same exe, `--update-window`).
/// Called by `install_update` before it hides the main window.
pub fn spawn_update_window() {
    let Ok(exe) = std::env::current_exe() else {
        tracing::warn!("update-window: current_exe unavailable, skipping the splash");
        return;
    };
    match std::process::Command::new(exe).arg("--update-window").spawn() {
        Ok(_) => tracing::info!("update-window: splash process spawned"),
        // The splash is presentation only: an update must never fail because
        // the pretty window could not start.
        Err(e) => tracing::warn!("update-window: could not spawn the splash: {e}"),
    }
}

/// The `--update-window` process entry: a minimal Tauri app (no plugins, no
/// server, no state) with one small frameless window on its OWN WebView2
/// profile, polling the progress file until the update finishes.
pub fn run(ctx: tauri::Context<tauri::Wry>) {
    let result = tauri::Builder::default()
        .setup(|app| {
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "update",
                tauri::WebviewUrl::App("update.html".into()),
            )
            .title("Updating Rillio")
            .inner_size(360.0, 420.0)
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            // NOT transparent: the page is an opaque full-bleed surface and
            // Windows 11 rounds + shadows the frameless window natively - a
            // transparent window + page-drawn card doubled the chrome (two
            // nested containers with mismatched radii).
            .always_on_top(true)
            .center();
            // Own WebView2 profile - see the module docs. Windows-only knob.
            #[cfg(windows)]
            {
                if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                    builder = builder.data_directory(
                        std::path::Path::new(&local)
                            .join(&app.config().identifier)
                            .join("EBWebViewUpdater"),
                    );
                }
            }
            let window = builder.build()?;

            // Poll the progress file and drive the page. WebviewWindow is Send:
            // eval marshals onto the right thread internally.
            std::thread::spawn(move || {
                let started = Instant::now();
                let mut last_payload = String::new();
                let mut installing_since: Option<Instant> = None;
                loop {
                    std::thread::sleep(Duration::from_millis(150));
                    // Hard cap: never outlive a wedged update by more than 10min.
                    if started.elapsed() > Duration::from_secs(600) {
                        std::process::exit(0);
                    }
                    match std::fs::read_to_string(progress_path()) {
                        Ok(raw) => {
                            let Ok(progress) = serde_json::from_str::<UpdateProgress>(&raw) else {
                                continue; // torn write; next poll gets a full frame
                            };
                            if progress.phase == "installing" && installing_since.is_none() {
                                installing_since = Some(Instant::now());
                            }
                            if progress.phase == "error" {
                                // Show the failure briefly, then get out of the way
                                // (the main app re-shows its own window on error).
                                if raw != last_payload {
                                    let _ = window.eval(&format!("window.__updateState({raw})"));
                                }
                                std::thread::sleep(Duration::from_secs(4));
                                std::process::exit(0);
                            }
                            if raw != last_payload {
                                last_payload = raw.clone();
                                let _ = window.eval(&format!("window.__updateState({raw})"));
                            }
                            // Backstop: NSIS quiet mode should relaunch the app
                            // itself; if the install phase drags on far beyond any
                            // sane install time, relaunch manually so the user is
                            // never stranded (single-instance makes a duplicate
                            // launch harmless: it just focuses the running app).
                            if let Some(t0) = installing_since {
                                if t0.elapsed() > Duration::from_secs(90) {
                                    if let Ok(exe) = std::env::current_exe() {
                                        let _ = std::process::Command::new(exe).spawn();
                                    }
                                    std::process::exit(0);
                                }
                            }
                        }
                        Err(_) => {
                            // File gone. During install that is THE success
                            // signal: the relaunched new app deletes it on boot.
                            // Before install it means a crashed/aborted updater -
                            // either way this window is done. Give the page a
                            // moment to show "Starting Rillio", then exit.
                            if installing_since.is_some() {
                                let _ = window.eval("window.__updateState({phase:'restarting'})");
                                std::thread::sleep(Duration::from_secs(2));
                            }
                            std::process::exit(0);
                        }
                    }
                }
            });
            Ok(())
        })
        .run(ctx);
    if let Err(e) = result {
        tracing::error!("update-window: failed to run: {e}");
    }
}
