#!/usr/bin/env bash
# Fetch the Android libmpv prebuilt into the Android project's jniLibs (Linux/CI).
# Bash counterpart of fetch-libmpv-android.ps1 - see that file for the full
# rationale (jarnedemeulemeester v1.0.0, libplacebo dovi default-on, GPL binaries,
# DV needs hwdec=no). jniLibs/**/*.so is gitignored, so CI must run this before
# the Android build.
set -euo pipefail

VERSION="v1.0.0"
URL="https://github.com/jarnedemeulemeester/libmpv-android/releases/download/${VERSION}/libmpv-release.aar"
# Every ABI the APK packages (CI builds a UNIVERSAL apk): arm64-v8a for modern
# devices, armeabi-v7a for 32-bit ones (an arm64-only APK is refused at install
# with "this phone doesn't support this app"), x86_64 for the emulator (native,
# no arm64 translation - the translated arm64 build's GLES calls fail on the
# emulated GPU). Keep this list in step with the --target list in
# .github/workflows/build-android.yml.
ABIS=(arm64-v8a armeabi-v7a x86_64)
LIBS=(libmpv.so libavcodec.so libavdevice.so libavfilter.so libavformat.so \
      libavutil.so libswresample.so libswscale.so libc++_shared.so)

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
jnilibs="${repo_root}/apps/desktop/src-tauri/gen/android/app/src/main/jniLibs"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "downloading ${URL}"
curl -fsSL "${URL}" -o "${tmp}/libmpv.aar"
unzip -q "${tmp}/libmpv.aar" -d "${tmp}/aar"

for abi in "${ABIS[@]}"; do
  mkdir -p "${jnilibs}/${abi}"
  for lib in "${LIBS[@]}"; do
    cp "${tmp}/aar/jni/${abi}/${lib}" "${jnilibs}/${abi}/"
    echo "  ${abi}/${lib}"
  done
done
echo "done: libmpv ${VERSION} staged into jniLibs"
