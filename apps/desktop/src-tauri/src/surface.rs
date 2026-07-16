//! Native render-surface seam: acquiring the video output surface and
//! compositing it behind the WebView. This is the single genuinely-hard-per-
//! platform concern, isolated here so the ~2000 lines of shared player logic in
//! shell.rs stay platform-free.
//!
//! Mirrors TropxMotion's transport seam: a trait (`NativeSurface`) with a
//! factory (`create`) that returns the implementation for the running platform.
//! Windows embeds mpv into the main window's HWND and z-orders it behind the
//! WebView; a platform without embedding returns `NoSurface` and the player
//! opens its own output window. The interface is a trait object (calling code
//! stays platform-agnostic); construction is `#[cfg]`-gated so only the target's
//! backend compiles.

use tauri::AppHandle;

/// The two per-platform operations the player needs from the windowing system.
pub trait NativeSurface: Send + Sync {
    /// An opaque window handle (mpv `wid`) to render the video into, or `None`
    /// to let the player open its own output window.
    fn video_wid(&self, app: &AppHandle) -> Option<isize>;
    /// Push the player's output behind the WebView so the UI overlays it.
    /// A no-op where the player owns its own window.
    fn composite_behind_ui(&self, app: &AppHandle);
}

/// The surface backend for the running platform (the `createBleService`
/// analogue). Construction is compile-time per target; the returned trait
/// object keeps callers platform-free.
pub fn create() -> Box<dyn NativeSurface> {
    #[cfg(windows)]
    {
        Box::new(WindowsSurface)
    }
    // Android [Phase 2] = AndroidSurface (SurfaceView handoff). Everything else
    // embeds nothing and lets the player open its own window.
    #[cfg(not(windows))]
    {
        Box::new(NoSurface)
    }
}

/// No embedding: the player opens its own output window; nothing to composite.
#[cfg(not(windows))]
struct NoSurface;
#[cfg(not(windows))]
impl NativeSurface for NoSurface {
    fn video_wid(&self, _app: &AppHandle) -> Option<isize> {
        None
    }
    fn composite_behind_ui(&self, _app: &AppHandle) {}
}

/// Windows: mpv renders into the main window's HWND (embedded) and is z-ordered
/// behind the transparent WebView so the UI overlays it.
#[cfg(windows)]
struct WindowsSurface;

#[cfg(windows)]
impl NativeSurface for WindowsSurface {
    /// The main window's HWND as an mpv `wid`, if in-window embedding is enabled
    /// (`RILLIO_EMBED_MPV`). Otherwise `None` -> mpv uses its own output window
    /// (the working default; see `lib::mpv_embed_enabled`).
    fn video_wid(&self, app: &AppHandle) -> Option<isize> {
        use tauri::Manager;
        if !crate::mpv_embed_enabled() {
            return None;
        }
        let window = app.get_webview_window("main")?;
        let hwnd = window.hwnd().ok()?;
        Some(hwnd.0 as isize)
    }

    /// Push mpv's embedded video child window to the bottom of the main window's
    /// z-order, so the (transparent-during-playback) WebView renders on top and
    /// its controls overlay the video. mpv registers its output window with
    /// class "mpv" as a child of the `wid` we gave it.
    fn composite_behind_ui(&self, app: &AppHandle) {
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
}
