//! Runtime platform detection + capability config, the selector the native
//! backends are chosen from.
//!
//! Mirrors TropxMotion's `PlatformConfig` (noble on Windows/Mac, node-ble on
//! Linux): one `detect()` returns the running platform, and `caps()` returns a
//! capability set the factories (native surface, player backend, host lifecycle)
//! read to pick and configure their implementation. The interface each factory
//! returns is a trait object (runtime polymorphism, so calling code is
//! platform-agnostic); only the construction is `#[cfg]`-gated per target.

/// The device family the shell is running on. `detect()` is the single source
/// of truth; everything else keys off it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    /// Android phone/tablet/TV (Phase 2). Distinguished from a plain desktop
    /// Linux because the whole native stack (surface, player, host) differs.
    Android,
    /// Any other host (desktop Linux/macOS): no native player backend yet, the
    /// web client falls back to its in-WebView player.
    Other,
}

impl Platform {
    pub fn detect() -> Self {
        #[cfg(target_os = "windows")]
        {
            Platform::Windows
        }
        #[cfg(target_os = "android")]
        {
            Platform::Android
        }
        #[cfg(not(any(target_os = "windows", target_os = "android")))]
        {
            Platform::Other
        }
    }
}

/// What the running platform's native backends can do. The factories read these
/// instead of re-testing `cfg` at every call site (the same role as TropX's
/// `features: { supportsParallelConnections, ... }`). Windows = today's values;
/// an Android build supplies its own set in Phase 2.
#[derive(Debug, Clone, Copy)]
pub struct PlatformCaps {
    /// Video renders into the app window behind the WebView (Windows HWND
    /// embedding). When false the native player owns its own output surface.
    pub embed_video: bool,
    /// The GPU panel-blur shader is available (mpv/libplacebo user shader).
    pub gpu_blur: bool,
    /// Updates arrive through the signed in-app updater (vs an OS app store).
    pub signed_updater: bool,
    /// The host keeps a WebView2 profile whose caches must be swept on version
    /// change (Windows-desktop only).
    pub webview2_cache: bool,
}

impl PlatformCaps {
    pub fn current() -> Self {
        match Platform::detect() {
            Platform::Windows => PlatformCaps {
                embed_video: true,
                gpu_blur: true,
                signed_updater: true,
                webview2_cache: true,
            },
            // Filled in Phase 2. Conservative defaults so a partial Android
            // build fails safe (no embedding, no blur, store updates).
            Platform::Android => PlatformCaps {
                embed_video: false,
                gpu_blur: false,
                signed_updater: false,
                webview2_cache: false,
            },
            Platform::Other => PlatformCaps {
                embed_video: false,
                gpu_blur: false,
                signed_updater: false,
                webview2_cache: false,
            },
        }
    }
}
