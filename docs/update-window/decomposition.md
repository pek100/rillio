# Custom update window (liquid) - decomposition

<!--
id: update-window-decomposition
tags: updater, shell, liquid-animation, brand, priority-high
related_files: apps/desktop/src-tauri/src/lib.rs, apps/web/src/App/UpdatingOverlay/UpdatingOverlay.tsx, apps/web/index.html (fluid logo), apps/web/src/App/UpdaterBanner
status: approved, in-progress (started 2026-07-17, end of session - continue here)
-->

Michael's directive: replace the unbranded update-install experience with a
SMALL CUSTOM WINDOW (Discord-style), "compose more liquid animations there"
(extend the fluid-fill WebGL family). Approved scope: the UPDATE window only;
the fresh-install bootstrapper exe is a separate later arc (same animation page
would be reused).

Today's flow: update toast -> in-app UpdatingOverlay (download, now with the
Hydra telemetry) -> app exits -> NSIS runs SILENTLY (dead unbranded gap) ->
new version launches.

Target flow: update accepted -> the MAIN window hides -> a small (~420x360)
frameless, transparent, centered, always-on-top WebviewWindow appears ->
liquid composition (fluid-fill logo + ambient liquid background) + rolling %
+ speed during download -> "Installing..." liquid state while NSIS runs ->
the new version's launch closes it (or it dies with the process).

```
[Update window]
├── [A. Recon] How the updater runs today: find the tauri-plugin-updater usage
│   (download_and_install? where 'update-progress' is emitted), whether the
│   install phase blocks in-process, what survives app exit ✓ atomic
├── [B. The window] #[cfg(desktop)] fn build_update_window(app): frameless,
│   transparent, 420x360, centered, always-on-top, skip_taskbar(false),
│   WebviewUrl -> "tauri://localhost/update.html" (a SECOND static page baked
│   into the bundle - add apps/web/build/update.html via webpack copy or a
│   plain file in the web build output) ✓ atomic
├── [C. The page] update.html: self-contained (inline JS/CSS, no bundle dep):
│   ├── [C1] the fluid-fill logo (reuse the index.html WebGL module - extract
│   │        to a shared snippet both pages inline) ✓ atomic
│   ├── [C2] NEW liquid composition: ambient liquid background (metaball blobs
│   │        or a slow displacement field in the same WebGL context, accent
│   │        #FFA033 on black, subtle) behind the mark ✓ atomic
│   ├── [C3] rolling % (the CSS remount trick from
│   │        components/ui/animated-percentage - inline a copy) + status line
│   │        ("Downloading" -> "Installing" -> "Restarting") ✓ atomic
│   └── [C4] listens to the same 'update-progress' Tauri event + an
│            'update-phase' event the shell emits ✓ atomic
├── [D. Flow wiring] on update accepted: create the update window, hide the
│   main window (do NOT close it - the updater task runs in-process), emit
│   phases; on install start emit 'installing'; the restart kills everything ✓
├── [E. Fallbacks] if the window fails to build, keep the current in-app
│   overlay path (it stays as the browser/web fallback anyway) ✓ atomic
└── [F. Verify] simulated: drive update-progress over CDP against the update
    window; real: a dev-signed update roundtrip if feasible ✓ atomic
```

## Recon findings (step A, DONE 2026-07-17)

`install_update` in lib.rs:646-709: check -> `update.download(...)` emitting
'update-progress' -> set UpdateInFlight -> **DESTROY the main webview window**
-> `wait_for_webview_profile_release` (THE 0.1.17 DATA-WIPE FIX: WebView2 must
fully release the Local Storage leveldb before the installer runs; never regress
this) -> install (**NSIS runs in PASSIVE mode** - the stock Windows progress
dialog Michael wants replaced - and relaunches the app; the plugin exits the
process immediately after launching it).

**Architectural consequences:**
1. The update window MUST use its OWN WebView2 data directory
   (`WebviewWindowBuilder::data_directory`, e.g. EBWebViewUpdater) or it holds
   the SAME profile lock the wipe-fix waits on - deadlock/timeout.
2. An in-process window DIES when the plugin exits the process at install
   handoff -> it can only cover the DOWNLOAD phase. The INSTALL phase needs a
   DETACHED PROCESS. Elegant shape: the same exe with a `--update-window` flag
   (no new artifact): spawn detached before handoff, it shows update.html
   ("Installing..." liquid state), polls for the relaunched new version (or
   parent-pid death + timeout) and exits. Then switch NSIS passive -> /S
   (silent) since our window replaces the stock dialog.
3. Single-instance plugin: the `--update-window` mode must SKIP single-instance
   (or the relaunched app would focus the splash / the splash would be blocked).

Phasing: B1 = detached `--update-window` process mode covering download AND
install (spawn it when the user accepts, main window hides immediately; it
reads progress from... the main process can't emit Tauri events cross-process -
use a tiny local file (progress.json in the temp dir, written by install_update,
polled by the splash) or a localhost socket; file-poll is simplest and robust).
B2 = flip NSIS passive -> silent. Keep the in-app overlay as fallback.

Notes:
- The in-app UpdatingOverlay STAYS (web + fallback path); the window is the
  desktop upgrade of it.
- The transparent+frameless window must avoid the tao maximized-NCCALCSIZE
  trap - it is never maximized, fine (see memory fullscreen-taskbar bug).
- Keep the liquid tasteful: black bg, accent fluid, no chrome; window drag
  region = whole surface.
- Update window + UpdatingOverlay share the phase vocabulary:
  'download' (with progress) / 'installing' / 'error'.
