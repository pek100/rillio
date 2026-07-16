# Android mpv player - decomposition

<!--
id: android-mpv-decomposition
tags: player, android, mpv, hdr, dolby-vision, native, priority-critical
related_files: apps/desktop/src-tauri/src/shell.rs, apps/desktop/src-tauri/src/surface.rs, apps/desktop/src-tauri/src/platform.rs, apps/desktop/src-tauri/src/mpv.rs, apps/desktop/src-tauri/gen/android/
checklist: checklists/android-mpv.md
doc: docs/android-mpv/README.md
status: in-progress
last_sync: 2026-07-17
-->

Decision record: Rillio uses **libmpv + libplacebo on Android** (NOT Media3/ExoPlayer).
Rationale: rendering consistency with Windows (same DV RPU application, same bugs,
same look), testability (DV correctness = software, verifiable by frame-diff on an
emulator without an HDR panel), and less dependence on per-device DV licensing.
Cost accepted: no hardware Dolby Vision passthrough (we render DV -> HDR10/SDR via
shaders, like Windows); performance depends on SoC (hwdec=mediacodec-copy).
This supersedes the earlier "Android DV forces Media3" analysis, which was about
maximizing hardware passthrough - a goal Michael explicitly traded away.

```
[Android mpv player]
├── [A. libmpv.so for arm64-android]
│   ├── [A1] Pick source: prebuilt (media-kit/jarnedemeulemeester) vs mpv-android
│   │        buildscripts (Linux-only -> WSL2/Docker on this host) ✓ atomic (research)
│   ├── [A2] Verify build flags: libplacebo WITH libdovi, ffmpeg WITH mediacodec,
│   │        libass, Vulkan+GLES contexts ✓ atomic
│   ├── [A3] Place .so (+ deps) in gen/android jniLibs/arm64-v8a ✓ atomic
│   └── [A4] dlopen path resolution on Android (mpv::default_dll_path seam) ✓ atomic
├── [B. Video surface behind the WebView]
│   ├── [B1] Kotlin: SurfaceView added under the WebView, setZOrderOnTop(false),
│   │        transparent WebView background ✓ atomic
│   ├── [B2] Surface -> ANativeWindow* -> pass raw pointer to Rust ✓ atomic
│   ├── [B3] surface.rs: AndroidSurface arm of NativeSurface (video_wid,
│   │        composite_behind_ui = no-op, z-order is fixed by construction) ✓ atomic
│   ├── [B4] Surface lifecycle: surfaceCreated/Destroyed -> mpv wid attach/detach
│   │        (mpv must never render into a dead ANativeWindow) ✓ atomic
│   └── [B5] platform.rs caps: embed_video=true on Android once B works ✓ atomic
├── [C. Controller wiring]
│   ├── [C1] JavaVM handoff: av_jni_set_java_vm via ndk-context (JNI shim) ✓ atomic
│   ├── [C2] Android option profile: hwdec=mediacodec-copy, ao=audiotrack,
│   │        vo=gpu-next, gpu-context selection (android/vulkan) ✓ atomic
│   ├── [C3] cfg-gate the Windows-only options (target-colorspace-hint tuning,
│   │        icc-profile-auto, d3d11 bits) ✓ atomic
│   └── [C4] NativePlayer::Mpv construction on Android (remove the "playback
│   │        disabled" path; fail loud if libmpv.so missing) ✓ atomic
├── [D. End-to-end SDR verify on emulator]
│   ├── [D1] 1080p H.264 SDR plays via existing bridge (loadfile from streaming
│   │        server) ✓ atomic
│   ├── [D2] Controls work: pause/seek/tracks/subtitles through shell_send ✓ atomic
│   └── [D3] Stats + snapshot/thumbs paths survive (or cleanly cap-gated) ✓ atomic
├── [E. DV/HDR correctness]
│   ├── [E1] DV clip renders (tone-mapped) on emulator; screenshot-diff same frame
│   │        vs Windows ✓ atomic
│   └── [E2] HDR output mode (Vulkan HDR swapchain / target-colorspace-hint) on a
│            real HDR device - FOLLOW-UP, SDR-tonemap ships first ✓ atomic
└── [F. Real device validation]
    ├── [F1] Performance: 4K HEVC mediacodec-copy benchmark on a real box ✓ atomic
    └── [F2] Audio passthrough sanity (AC3/EAC3 via audiotrack) ✓ atomic
```

Known risks, ordered:
1. A is the long pole: getting a libmpv.so with dovi-enabled libplacebo. If prebuilts
   lack libdovi, we build via WSL2/Docker with mpv-android buildscripts (hours).
2. mediacodec-copy perf at 4K on weak SoCs (F1 decides the floor; emulator says nothing).
3. Surface lifecycle races (B4) - the classic libmpv-android crash source.
4. HDR *output* on Android (E2) is genuinely newer ground than tone-mapped SDR.
