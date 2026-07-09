//! S3 — libmpv binding.
//!
//! Dynamically loads `libmpv-2.dll` and calls the stable libmpv v2 client API
//! via hand-declared FFI. This keeps the shell DLL-agnostic: it needs only a
//! `libmpv-2.dll` at runtime (any official build), no dev headers or import lib.
//!
//! Playback uses mpv's `wid` embedding: mpv renders into a native window handle
//! we hand it, so we don't manage a GL/D3D render context ourselves. This module
//! is the raw binding; window wiring + the web bridge build on top.

use std::ffi::{c_char, c_int, c_ulong, c_void, CString};
use std::path::{Path, PathBuf};

use libloading::Library;

// libmpv v2 client API signatures (mpv/client.h). Only what playback needs.
type MpvClientApiVersion = unsafe extern "C" fn() -> c_ulong;
type MpvCreate = unsafe extern "C" fn() -> *mut c_void;
type MpvInitialize = unsafe extern "C" fn(*mut c_void) -> c_int;
type MpvTerminateDestroy = unsafe extern "C" fn(*mut c_void);
type MpvSetOptionString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvSetPropertyString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvCommand = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
type MpvErrorString = unsafe extern "C" fn(c_int) -> *const c_char;

struct Api {
    client_api_version: MpvClientApiVersion,
    create: MpvCreate,
    initialize: MpvInitialize,
    terminate_destroy: MpvTerminateDestroy,
    set_option_string: MpvSetOptionString,
    set_property_string: MpvSetPropertyString,
    command: MpvCommand,
    error_string: MpvErrorString,
}

/// A loaded mpv instance. `Drop` destroys it. Not `Sync`; drive it from one
/// thread (or wrap in a mutex).
pub struct Mpv {
    api: Api,
    ctx: *mut c_void,
    // The Library must outlive every function pointer above; dropped last.
    _lib: Library,
}

impl Mpv {
    /// Load `libmpv-2.dll` from `dll_path` and create an (uninitialized) mpv
    /// context. Set options with [`set_option`], then call [`initialize`].
    pub fn load(dll_path: &Path) -> Result<Self, String> {
        // Ensure the DLL's own directory is searched for its dependencies (a
        // non-self-contained build sits next to its ffmpeg DLLs). A distribution
        // build ships a self-contained libmpv-2.dll and this is a no-op.
        if let Some(dir) = dll_path.parent() {
            let path = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{};{path}", dir.display()));
        }
        unsafe {
            let lib = Library::new(dll_path).map_err(|e| format!("load {dll_path:?}: {e}"))?;
            macro_rules! sym {
                ($name:literal, $ty:ty) => {{
                    let s = lib
                        .get::<$ty>(concat!($name, "\0").as_bytes())
                        .map_err(|e| format!("symbol {}: {e}", $name))?;
                    *s
                }};
            }
            let api = Api {
                client_api_version: sym!("mpv_client_api_version", MpvClientApiVersion),
                create: sym!("mpv_create", MpvCreate),
                initialize: sym!("mpv_initialize", MpvInitialize),
                terminate_destroy: sym!("mpv_terminate_destroy", MpvTerminateDestroy),
                set_option_string: sym!("mpv_set_option_string", MpvSetOptionString),
                set_property_string: sym!("mpv_set_property_string", MpvSetPropertyString),
                command: sym!("mpv_command", MpvCommand),
                error_string: sym!("mpv_error_string", MpvErrorString),
            };
            let ctx = (api.create)();
            if ctx.is_null() {
                return Err("mpv_create returned null".into());
            }
            Ok(Self { api, ctx, _lib: lib })
        }
    }

    /// The libmpv client API version the loaded DLL reports (sanity check).
    pub fn client_api_version(&self) -> c_ulong {
        unsafe { (self.api.client_api_version)() }
    }

    /// Set an option before [`initialize`] (e.g. `wid`, `vo`, `hwdec`).
    pub fn set_option(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstr(name)?, cstr(value)?);
        self.check(unsafe { (self.api.set_option_string)(self.ctx, n.as_ptr(), v.as_ptr()) })
    }

    /// Finish initialization (creates the audio/video output).
    pub fn initialize(&self) -> Result<(), String> {
        self.check(unsafe { (self.api.initialize)(self.ctx) })
    }

    /// Set a property at runtime (e.g. `pause`, `volume`, `time-pos`).
    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstr(name)?, cstr(value)?);
        self.check(unsafe { (self.api.set_property_string)(self.ctx, n.as_ptr(), v.as_ptr()) })
    }

    /// Run a command, e.g. `["loadfile", url]`, `["stop"]`, `["seek", "10"]`.
    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let cstrings: Vec<CString> = args.iter().map(|a| cstr(a)).collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null()); // NULL-terminated argv
        self.check(unsafe { (self.api.command)(self.ctx, ptrs.as_ptr()) })
    }

    fn check(&self, code: c_int) -> Result<(), String> {
        if code >= 0 {
            Ok(())
        } else {
            let msg = unsafe {
                std::ffi::CStr::from_ptr((self.api.error_string)(code))
                    .to_string_lossy()
                    .into_owned()
            };
            Err(format!("mpv error {code}: {msg}"))
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        unsafe { (self.api.terminate_destroy)(self.ctx) }
    }
}

// The libmpv client API is thread-safe: an `mpv_handle` may be used from
// multiple threads. We serialize access behind a Mutex in Tauri state anyway.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| format!("interior NUL in {s:?}"))
}

/// Default location of the dev/bundled `libmpv-2.dll`: next to the executable,
/// falling back to the crate dir during `cargo test`/`run`.
pub fn default_dll_path() -> PathBuf {
    // Dev override: point at any libmpv-2.dll (e.g. an on-machine build).
    if let Ok(p) = std::env::var("STREMIO_LIBMPV") {
        let p = PathBuf::from(p);
        if p.exists() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("libmpv-2.dll");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("libmpv-2.dll")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Candidate libmpv locations for the dev machine: env override, our
    /// (possibly non-self-contained) copy, or a known on-machine libmpv.
    fn dev_dll() -> Option<PathBuf> {
        if let Ok(p) = std::env::var("STREMIO_LIBMPV") {
            let p = PathBuf::from(p);
            if p.exists() {
                return Some(p);
            }
        }
        let candidates = [
            default_dll_path(),
            // Known self-consistent libmpv on this machine (loaded from its own
            // dir so its ffmpeg deps resolve).
            PathBuf::from(r"F:\Topaz Labs LLC\Topaz Video AI\mpv-2.dll"),
        ];
        candidates.into_iter().find(|p| p.exists())
    }

    /// Loads the on-disk libmpv and initializes a headless mpv instance
    /// (`vo=null`, `ao=null`). Skips if no libmpv is present (it is provided
    /// per-machine; distribution bundles a self-contained one).
    #[test]
    fn loads_and_initializes_libmpv() {
        let Some(dll) = dev_dll() else {
            eprintln!("[skip] no libmpv-2.dll found");
            return;
        };
        let mpv = Mpv::load(&dll).expect("load libmpv");
        assert!(mpv.client_api_version() >= (2 << 16), "expect client API v2+");
        // Headless init: no window, no audio device.
        mpv.set_option("vo", "null").unwrap();
        mpv.set_option("ao", "null").unwrap();
        mpv.initialize().expect("mpv_initialize");
        // A benign runtime property set proves the live handle works.
        mpv.set_property("volume", "100").expect("set volume");
    }
}
