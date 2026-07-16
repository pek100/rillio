# Cross-platform seams (Windows now, Android TV later)

Goal: make the Tauri shell select its native backends at runtime per device,
so an Android TV build reuses the Windows work as sibling implementations
rather than a fork. Phase 1 (this branch) extracts the seams on Windows with
ZERO behavior change. Phase 2 (later) adds the Android implementations behind
the same seams.

## The pattern (mirrored from TropxMotion's BLE factory)

TropxMotion picks its Bluetooth backend at runtime: `PlatformConfig.detectPlatform()`
returns a config (transport + strategy + timing + capability flags), a factory
(`createBleService`) constructs the right backend behind one interface
(`IBleService`), and a `NodeBleToNobleAdapter` normalizes the weaker backend to
the canonical vocabulary so the rest of the app speaks one language.

Rillio's Rust equivalent:

| TropX (JS, runtime import) | Rillio (Rust) |
| --- | --- |
| `IBleService` interface | `PlayerBackend` / `NativeSurface` / `HostPlatform` traits |
| `PlatformConfig.detectPlatform()` + capability flags | `platform::detect()` + `PlatformCaps` |
| `createBleService()` factory | `create_*` factory fns returning `Box<dyn Trait>` |
| noble backend (Windows/Mac) | libmpv backend (Windows) |
| node-ble backend (Linux) | Media3 backend (Android) [Phase 2] |
| `NodeBleToNobleAdapter` | `Media3` adapter emitting mpv-shaped props [Phase 2] |

Rust nuance: the trait gives runtime polymorphism (the "dynamic per device"
ask, calling code stays platform-agnostic via `Box<dyn Trait>`), while the
factory's construction is `#[cfg(target_os)]`-gated so only the backend the
target supports compiles. Interface = runtime; construction = compile-time.

## The seams

1. **`PlayerBackend`** (the mpv-shaped bridge contract). Canonical player
   interface the web `ShellVideo` talks to over `shell_send`/`shell-signal`.
   Windows impl = `MpvBackend` wrapping today's `Controller`. Capability-gated
   methods (blur, snapshot, scene-scan) have default no-op impls, matching
   TropX's feature flags. Android impl [Phase 2] = Media3 behind the same trait.

2. **`NativeSurface`** (render target + compositing). Formalize the already
   `#[cfg]`-stubbed `main_window_wid()` + `composite_behind_webview()` into one
   trait: acquire an opaque surface, composite it behind the WebView. This is
   the single genuinely-hard-per-platform concern; isolating it keeps the ~2000
   lines of shared player logic platform-free.

3. **`HostPlatform`** (lifecycle). Quarantine the WebView2 cache clearing,
   updater, profile-lock poll, and in-exe-folder cache (~400 lines in lib.rs)
   behind a trait so Android supplies `getFilesDir` cache + Play/APK update as a
   sibling instead of `#cfg`-ing each function. Mostly "delete on Android" code.

4. **Input source** (web, TS). Normalize Web-Gamepad events and Android-TV
   D-pad key events into the one `direction` dispatch `services/GamepadNavigation`
   already consumes. Plus an `'android'` arm in `packages/video/src/platform.js`.

## Phase 1 checklist (Windows, no behavior change, keep GREEN + run after each)

- [ ] `platform.rs`: `Platform` enum + `detect()` + `PlatformCaps` (embed_video,
      gpu_blur, signed_updater, webview2_cache). Windows caps = today's values.
- [ ] `NativeSurface` trait + `WindowsSurface` impl wrapping `main_window_wid`
      + `composite_behind_webview`. Factory `create_native_surface()`. Callers
      use the trait. Non-Windows already stubbed.
- [ ] `PlayerBackend` trait + `MpvBackend` impl wrapping `Controller`. `shell_send`
      + all player commands route through `Box<dyn PlayerBackend>` held in
      `ShellState`. Bridge contract + allowlists UNCHANGED.
- [ ] `HostPlatform` trait + `WindowsHost` impl for cache-dir / cache-clear /
      updater / profile-release. `lib.rs` calls the trait.
- [ ] Web: input-source seam in `GamepadContext` + `'android'` arm in platform.js
      (inert on Windows).
- [ ] Verify: cargo build green, cargo test green, launch shell, play the cached
      Silo title, confirm HDR/DV + blur + trickplay + chapters all still work
      (the whole point: byte-identical Windows behavior).

## Phase 2 (Android TV, separate branch, later)

Android impls behind each trait: `AndroidSurface` (SurfaceView), `Media3Backend`
(ExoPlayer, DV/HDR gated on `Display.getHdrCapabilities()`), `AndroidHost`
(scoped storage + Play update). Cross-compile streaming server to
aarch64-linux-android (switch `default-tls` -> rustls). Leanback manifest.
D-pad key events into the input seam. Then CI/CD (NDK + keystore + arm64 AAB).
See the research in the session that produced this doc; DV Profile 7 degrades to
HDR10 on nearly all TV hardware (honest caveat).
