//! S3 - libmpv binding.
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
// mpv_observe_property(handle, reply_userdata, name, format) - subscribe to a
// property; changes (and one initial value) arrive as PROPERTY_CHANGE events.
type MpvObserveProperty = unsafe extern "C" fn(*mut c_void, u64, *const c_char, c_int) -> c_int;
// mpv_wait_event(handle, timeout_s) - block for the next event on this handle.
// The returned pointer is owned by mpv and valid until the next wait_event.
type MpvWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEventRaw;
// mpv_request_log_messages(handle, min_level) - stream mpv's own log at
// `min_level` ("info", "v", "debug", …) as LOG_MESSAGE events.
type MpvRequestLogMessages = unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int;

// mpv_format values (mpv/client.h). We observe every property as NODE so the
// event carries a self-describing value we can map straight to JSON.
const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE: c_int = 6;
const MPV_FORMAT_NODE_ARRAY: c_int = 7;
const MPV_FORMAT_NODE_MAP: c_int = 8;

// mpv_event_id values we care about.
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_LOG_MESSAGE: c_int = 2;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

/// `mpv_node` (mpv/client.h). The C type is a tagged union; on 64-bit every
/// union member (pointer / int64 / double) is 8 bytes, so we hold the payload as
/// a raw `u64` and reinterpret per `format`. Layout matches the C struct
/// (8-byte payload + 4-byte tag, 8-byte aligned = 16 bytes).
#[repr(C)]
struct MpvNode {
    u: u64,
    format: c_int,
}

/// `mpv_node_list` - the backing store for NODE_ARRAY / NODE_MAP nodes.
#[repr(C)]
struct MpvNodeList {
    num: c_int,
    values: *mut MpvNode,
    keys: *mut *mut c_char,
}

/// `mpv_event_property` - payload of a PROPERTY_CHANGE event.
#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

/// `mpv_event_end_file` - payload of an END_FILE event.
#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

/// `mpv_event_log_message` - payload of a LOG_MESSAGE event.
#[repr(C)]
struct MpvEventLogMessage {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
    log_level: c_int,
}

/// `mpv_event` - the fixed header every event shares.
#[repr(C)]
struct MpvEventRaw {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

/// A translated mpv event, ready to forward to the web client.
pub enum MpvEvent {
    /// An observed property changed (or reported its initial value).
    PropertyChange { name: String, value: serde_json::Value },
    /// Playback of the current file ended. `reason`/`error` are mpv's raw codes.
    EndFile { reason: c_int, error: c_int },
    /// A line from mpv's own log (diagnostics): `prefix`, `level`, `text`.
    LogMessage { prefix: String, level: String, text: String },
    /// mpv is shutting down; the event loop should stop.
    Shutdown,
    /// Anything we don't translate (timeouts, reconfig, replies, …).
    Other,
}

struct Api {
    client_api_version: MpvClientApiVersion,
    create: MpvCreate,
    initialize: MpvInitialize,
    terminate_destroy: MpvTerminateDestroy,
    set_option_string: MpvSetOptionString,
    set_property_string: MpvSetPropertyString,
    command: MpvCommand,
    error_string: MpvErrorString,
    observe_property: MpvObserveProperty,
    wait_event: MpvWaitEvent,
    request_log_messages: MpvRequestLogMessages,
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
        // APPEND (not prepend) the dir so the system directories keep precedence,
        // prepending would let a planted DLL in this dir shadow a system one.
        if let Some(dir) = dll_path.parent() {
            let path = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{path};{}", dir.display()));
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
                observe_property: sym!("mpv_observe_property", MpvObserveProperty),
                wait_event: sym!("mpv_wait_event", MpvWaitEvent),
                request_log_messages: sym!("mpv_request_log_messages", MpvRequestLogMessages),
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

    /// Subscribe to a property. mpv delivers one initial value immediately and
    /// then a PROPERTY_CHANGE event on every change. We always request
    /// `MPV_FORMAT_NODE` so [`wait_event`](Self::wait_event) can render any type.
    pub fn observe_property(&self, name: &str) -> Result<(), String> {
        let n = cstr(name)?;
        self.check(unsafe { (self.api.observe_property)(self.ctx, 0, n.as_ptr(), MPV_FORMAT_NODE) })
    }

    /// Ask mpv to stream its own log at `min_level` ("info", "v", "debug", …)
    /// as LOG_MESSAGE events. Diagnostics only.
    pub fn request_log_messages(&self, min_level: &str) -> Result<(), String> {
        let l = cstr(min_level)?;
        self.check(unsafe { (self.api.request_log_messages)(self.ctx, l.as_ptr()) })
    }

    /// Block up to `timeout` seconds (negative = forever) for the next event and
    /// translate it. Call this from a single dedicated thread; other threads may
    /// concurrently issue commands/property sets on the same handle.
    pub fn wait_event(&self, timeout: f64) -> MpvEvent {
        unsafe {
            let ev = (self.api.wait_event)(self.ctx, timeout);
            if ev.is_null() {
                return MpvEvent::Other;
            }
            match (*ev).event_id {
                MPV_EVENT_SHUTDOWN => MpvEvent::Shutdown,
                MPV_EVENT_LOG_MESSAGE => {
                    let m = (*ev).data as *const MpvEventLogMessage;
                    if m.is_null() {
                        return MpvEvent::Other;
                    }
                    MpvEvent::LogMessage {
                        prefix: cstr_to_string((*m).prefix),
                        level: cstr_to_string((*m).level),
                        text: cstr_to_string((*m).text).trim_end().to_string(),
                    }
                }
                MPV_EVENT_END_FILE => {
                    let ef = (*ev).data as *const MpvEventEndFile;
                    if ef.is_null() {
                        MpvEvent::EndFile { reason: 0, error: 0 }
                    } else {
                        MpvEvent::EndFile { reason: (*ef).reason, error: (*ef).error }
                    }
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    let p = (*ev).data as *const MpvEventProperty;
                    if p.is_null() || (*p).name.is_null() {
                        return MpvEvent::Other;
                    }
                    let name = cstr_to_string((*p).name);
                    let value = if (*p).format == MPV_FORMAT_NODE && !(*p).data.is_null() {
                        node_to_json(&*((*p).data as *const MpvNode))
                    } else {
                        serde_json::Value::Null
                    };
                    MpvEvent::PropertyChange { name, value }
                }
                _ => MpvEvent::Other,
            }
        }
    }

    /// Human-readable text for an mpv error code (for END_FILE errors).
    pub fn error_string(&self, code: c_int) -> String {
        unsafe {
            std::ffi::CStr::from_ptr((self.api.error_string)(code))
                .to_string_lossy()
                .into_owned()
        }
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

/// Copy a C string into an owned `String` (lossy). NULL → empty string.
unsafe fn cstr_to_string(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

/// Convert an `mpv_node` into a `serde_json::Value`, recursing through
/// arrays/maps. The node's `format` tag drives how the 8-byte payload is read
/// (little-endian x86-64: a flag/int occupies the low bytes of `u`).
unsafe fn node_to_json(node: &MpvNode) -> serde_json::Value {
    use serde_json::Value;
    match node.format {
        MPV_FORMAT_STRING => {
            Value::String(cstr_to_string(node.u as usize as *const c_char))
        }
        MPV_FORMAT_FLAG => Value::Bool((node.u as u32) != 0),
        MPV_FORMAT_INT64 => Value::from(node.u as i64),
        MPV_FORMAT_DOUBLE => serde_json::Number::from_f64(f64::from_bits(node.u))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        MPV_FORMAT_NODE_ARRAY => {
            let list = node.u as usize as *const MpvNodeList;
            if list.is_null() {
                return Value::Array(Vec::new());
            }
            let n = (*list).num.max(0) as usize;
            let mut arr = Vec::with_capacity(n);
            for i in 0..n {
                arr.push(node_to_json(&*(*list).values.add(i)));
            }
            Value::Array(arr)
        }
        MPV_FORMAT_NODE_MAP => {
            let list = node.u as usize as *const MpvNodeList;
            if list.is_null() {
                return Value::Object(serde_json::Map::new());
            }
            let n = (*list).num.max(0) as usize;
            let mut map = serde_json::Map::with_capacity(n);
            for i in 0..n {
                let key = cstr_to_string(*(*list).keys.add(i));
                map.insert(key, node_to_json(&*(*list).values.add(i)));
            }
            Value::Object(map)
        }
        // MPV_FORMAT_NONE / BYTE_ARRAY / anything unexpected.
        _ => Value::Null,
    }
}

/// Default location of the dev/bundled `libmpv-2.dll`: next to the executable,
/// falling back to the crate dir during `cargo test`/`run`.
pub fn default_dll_path() -> PathBuf {
    // Dev override: point at any libmpv-2.dll (e.g. an on-machine build).
    if let Ok(p) = std::env::var("RILLIO_LIBMPV") {
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
        if let Ok(p) = std::env::var("RILLIO_LIBMPV") {
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
