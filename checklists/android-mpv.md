# Android mpv player - checklist

<!--
id: android-mpv-checklist
tags: player, android, mpv, hdr, dolby-vision, priority-critical
related_files: apps/desktop/src-tauri/src/shell.rs, apps/desktop/src-tauri/src/surface.rs, apps/desktop/src-tauri/src/mpv.rs, apps/desktop/src-tauri/gen/android/
doc: docs/android-mpv/decomposition.md
status: in-progress
last_sync: 2026-07-17
-->

## A. libmpv.so for arm64-android
- [ ] A1 Research: prebuilt libmpv-android with libplacebo+dovi (media-kit,
      jarnedemeulemeester) vs building via mpv-android buildscripts (WSL2/Docker)
- [ ] A2 Verify flags of chosen artifact: libplacebo(dovi), ffmpeg(mediacodec),
      libass, vulkan/gles
- [ ] A3 Ship .so in jniLibs/arm64-v8a (APK packaging)
- [ ] A4 mpv loader resolves libmpv.so on Android (default_dll_path seam)

## B. Surface behind the WebView
- [ ] B1 Kotlin SurfaceView under WebView (setZOrderOnTop(false), transparent WebView)
- [ ] B2 ANativeWindow* handed to Rust
- [ ] B3 surface.rs: AndroidSurface arm of NativeSurface
- [ ] B4 Surface lifecycle -> mpv wid attach/detach (no dead-window renders)
- [ ] B5 platform.rs: embed_video=true on Android

## C. Controller wiring
- [ ] C1 JavaVM -> ffmpeg (av_jni_set_java_vm via ndk-context)
- [ ] C2 Android mpv profile: hwdec=mediacodec-copy, ao=audiotrack, vo=gpu-next
- [ ] C3 cfg-gate Windows-only mpv options
- [ ] C4 NativePlayer::Mpv constructed on Android, fail-loud if .so missing

## D. E2E SDR on emulator
- [ ] D1 1080p H.264 plays via existing shell_send bridge
- [ ] D2 pause/seek/tracks/subs work from the web UI
- [ ] D3 stats/snapshot/thumbs OK or cap-gated

## E. DV/HDR correctness
- [ ] E1 DV clip tone-maps on emulator; frame-diff vs Windows
- [ ] E2 HDR output mode on real HDR device (follow-up after SDR ships)

## F. Real device
- [ ] F1 4K HEVC mediacodec-copy perf on a real TV box
- [ ] F2 audio formats sanity (AC3/EAC3)

## Meta
- [ ] Update memory (android-tv-cross-platform.md): Media3 decision REVERSED -> libmpv
- [ ] Update docs/cross-platform-refactor.md wall-2 section to match
