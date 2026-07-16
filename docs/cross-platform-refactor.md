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
| node-ble backend (Linux) | libmpv backend, Android build (Phase 2 - see decision below) |
| `NodeBleToNobleAdapter` | (not needed: same backend on both platforms) |

Rust nuance: the trait gives runtime polymorphism (the "dynamic per device"
ask, calling code stays platform-agnostic via `Box<dyn Trait>`), while the
factory's construction is `#[cfg(target_os)]`-gated so only the backend the
target supports compiles. Interface = runtime; construction = compile-time.

## The seams

1. **`PlayerBackend`** (the mpv-shaped bridge contract). Canonical player
   interface the web `ShellVideo` talks to over `shell_send`/`shell-signal`.
   Windows impl = `MpvBackend` wrapping today's `Controller`. Capability-gated
   methods (blur, snapshot, scene-scan) have default no-op impls, matching
   TropX's feature flags. Android impl [Phase 2] = libmpv again (see decision
   record below) - the same `Controller`, different surface + option profile.

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

## Phase 1: DONE (Windows, behavior byte-identical, verified with real playback)

- [x] `platform.rs`: `Platform::detect()` + `PlatformCaps` (embed_video, gpu_blur,
      signed_updater, webview2_cache). Windows caps = today's values.
- [x] `surface.rs`: `NativeSurface` trait + `create()` factory + `WindowsSurface`
      (HWND wid + z-order compositing), moved out of shell.rs. Non-Windows =
      `NoSurface`. shell.rs calls the trait.
- [x] `shell.rs`: `NativePlayer` enum (the Rust-idiomatic factory for a closed
      backend set; `Mpv` variant today, `Android` Media3 later). `ShellState`
      holds it; `shell_send` / stats / snapshot / blur route through it. Security
      allowlists stay in `shell_send` (backend-agnostic); the loadfile/stop
      normalization moved into `Controller::run_command`.
- [x] Host-lifecycle seam (lighter than a full trait: the updater is
      data-loss-adjacent, not worth the risk): the WebView2 stale-cache sweep is
      gated on `PlatformCaps::webview2_cache` in lib.rs. The updater command and
      the in-exe cache dir are already Windows-shaped and simply not invoked on a
      store-updated / scoped-storage host. `default_cache_dir` already falls back
      to `app_data_dir` when the exe folder is not writable (Android scoped
      storage), so it ports as-is.
- [x] Verified: cargo build + 16/16 tests green; launched the shell, drove
      `loadfile` on the cached 4K DV/HDR Silo file, confirmed real HEVC 3840x1606
      decode, mpv embedding + `composite mpv behind WebView`, and `player.stats()`
      through the enum. Byte-identical Windows behavior.

Web-side seams moved to Phase 2 (they need the Android runtime to be meaningful;
inert untested code now would be speculative): the D-pad input source in
`GamepadContext` (Android remote key events -> the existing spatial-nav
`direction` dispatch) and the `'android'` arm in `packages/video/src/platform.js`
(VO / player selection) both land when the Android player exists to test against.

## Phase 2 (Android TV, branch cross-platform-seams)

### DECISION RECORD (2026-07-17): the Android player is libmpv, NOT Media3

The original Phase 2 plan said `Media3Backend` (ExoPlayer) because it is the only
path to hardware Dolby Vision passthrough on Android TV. Michael explicitly
reversed this: **Android uses the same libmpv + libplacebo engine as Windows.**

Rationale (consistency + testability + less hardware dependence):
- One rendering pipeline on every platform: libplacebo applies the DV RPU
  identically, same look, same bugs, same shader stack (blur, trickplay,
  snapshots, libass subs all come along for free instead of a Kotlin rewrite).
- DV correctness becomes a software question: verifiable by frame-diffing the
  same frame on Android vs Windows, on an emulator, with no HDR panel or DV
  license involved. Media3 DV was only verifiable on licensed hardware.
- Works on panels/boxes that never licensed DV (renders DV -> HDR10/SDR).

Accepted costs (stated at decision time):
- No hardware Dolby Vision passthrough - the TV's "Dolby Vision" badge will not
  light up; we shader-render like Windows. (This was the original doc's whole
  argument for Media3; the goal changed, so the conclusion changed.)
- Perf now depends on SoC muscle: libplacebo needs frame access, so decode is
  `hwdec=mediacodec-copy`. Fine Shield-class, unproven on weak Amlogic sticks -
  benchmark on a real box before declaring victory.
- HDR *output* (PQ swapchain on Android) is a follow-up; tone-mapped SDR ships
  first and proves the pipeline.

Plan + atomic decomposition: docs/android-mpv/decomposition.md, checklist at
checklists/android-mpv.md.

### Phase 2 status

Done so far: both Rust crates cross-compile to aarch64-linux-android (rustls,
per-target sha1, API 24), Android scaffold + TV manifest + banner, desktop-only
plugins cfg-gated, mobile WebView window (`build_mobile_window`), APK builds and
the full web UI renders + is interactive on an Android TV emulator; streaming
server + DHT verified downloading real torrents on-device. Remaining: the libmpv
Android player (see decision above), D-pad key events into the input seam,
`'android'` arm in `packages/video/src/platform.js`, hide the shell window
controls on Android, then CI/CD (NDK + keystore + arm64 AAB).
