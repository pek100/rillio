//! Minimal libmpv FFI for Stage 2: create a player + a render context that
//! draws into our ANGLE GL context. Loaded dynamically from STREMIO_LIBMPV so
//! it is DLL-agnostic (same approach as the shipping shell's src/mpv.rs).

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_int, c_void, CString};
use std::path::Path;

use libloading::{Library, Symbol};

pub type MpvHandle = *mut c_void;
pub type MpvRenderContext = *mut c_void;

// mpv_render_param types.
pub const MPV_RENDER_PARAM_INVALID: c_int = 0;
pub const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
pub const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
pub const MPV_RENDER_PARAM_ADVANCED_CONTROL: c_int = 10;

pub const MPV_RENDER_UPDATE_FRAME: u64 = 1;

#[repr(C)]
pub struct mpv_render_param {
    pub type_: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_opengl_init_params {
    pub get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct mpv_opengl_fbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

type FnCreate = unsafe extern "C" fn() -> MpvHandle;
type FnInitialize = unsafe extern "C" fn(MpvHandle) -> c_int;
type FnSetOptionString = unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int;
type FnCommand = unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int;
type FnTerminateDestroy = unsafe extern "C" fn(MpvHandle);
type FnRenderContextCreate =
    unsafe extern "C" fn(*mut MpvRenderContext, MpvHandle, *mut mpv_render_param) -> c_int;
type FnRenderContextRender = unsafe extern "C" fn(MpvRenderContext, *mut mpv_render_param) -> c_int;
type FnRenderContextUpdate = unsafe extern "C" fn(MpvRenderContext) -> u64;
type FnRenderContextSetUpdateCb =
    unsafe extern "C" fn(MpvRenderContext, unsafe extern "C" fn(*mut c_void), *mut c_void);
type FnRenderContextFree = unsafe extern "C" fn(MpvRenderContext);

/// Owns the loaded DLL and resolved entry points.
pub struct Mpv {
    _lib: Library,
    pub handle: MpvHandle,
    f_set_option_string: FnSetOptionString,
    f_command: FnCommand,
    f_terminate_destroy: FnTerminateDestroy,
    f_rc_create: FnRenderContextCreate,
    f_rc_render: FnRenderContextRender,
    f_rc_update: FnRenderContextUpdate,
    f_rc_set_update_cb: FnRenderContextSetUpdateCb,
    f_rc_free: FnRenderContextFree,
    pub render_ctx: MpvRenderContext,
}

unsafe fn sym<T>(lib: &Library, name: &[u8]) -> T {
    let s: Symbol<T> = lib.get(name).unwrap_or_else(|e| panic!("mpv sym {:?}: {e}", std::str::from_utf8(name)));
    std::mem::transmute_copy(&s)
}

impl Mpv {
    /// Load libmpv from `dll_path`, prepending its dir to PATH for ffmpeg deps.
    pub unsafe fn load(dll_path: &str) -> Result<Mpv, String> {
        if let Some(dir) = Path::new(dll_path).parent() {
            let cur = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{};{}", dir.display(), cur));
        }
        let lib = Library::new(dll_path).map_err(|e| format!("load {dll_path}: {e}"))?;
        let f_create: FnCreate = sym(&lib, b"mpv_create\0");
        let f_initialize: FnInitialize = sym(&lib, b"mpv_initialize\0");
        let f_set_option_string: FnSetOptionString = sym(&lib, b"mpv_set_option_string\0");
        let f_command: FnCommand = sym(&lib, b"mpv_command\0");
        let f_terminate_destroy: FnTerminateDestroy = sym(&lib, b"mpv_terminate_destroy\0");
        let f_rc_create: FnRenderContextCreate = sym(&lib, b"mpv_render_context_create\0");
        let f_rc_render: FnRenderContextRender = sym(&lib, b"mpv_render_context_render\0");
        let f_rc_update: FnRenderContextUpdate = sym(&lib, b"mpv_render_context_update\0");
        let f_rc_set_update_cb: FnRenderContextSetUpdateCb =
            sym(&lib, b"mpv_render_context_set_update_callback\0");
        let f_rc_free: FnRenderContextFree = sym(&lib, b"mpv_render_context_free\0");

        let handle = f_create();
        if handle.is_null() {
            return Err("mpv_create returned null".into());
        }
        // Best-effort options (this minimal build rejects some; never fatal).
        let mut set = |k: &str, v: &str| {
            let ck = CString::new(k).unwrap();
            let cv = CString::new(v).unwrap();
            let r = f_set_option_string(handle, ck.as_ptr(), cv.as_ptr());
            if r < 0 {
                eprintln!("mpv option {k}={v} rejected ({r})");
            }
        };
        let verbose = std::env::var("STREMIO_MPV_VERBOSE").is_ok();
        set("terminal", if verbose { "yes" } else { "no" });
        set("msg-level", if verbose { "all=v" } else { "all=error" });
        set("vo", "libmpv");
        set("hwdec", "auto-copy");
        set("gpu-api", "opengl");

        if f_initialize(handle) < 0 {
            return Err("mpv_initialize failed".into());
        }

        Ok(Mpv {
            _lib: lib,
            handle,
            f_set_option_string,
            f_command,
            f_terminate_destroy,
            f_rc_create,
            f_rc_render,
            f_rc_update,
            f_rc_set_update_cb,
            f_rc_free,
            render_ctx: std::ptr::null_mut(),
        })
    }

    pub unsafe fn set_option(&self, k: &str, v: &str) {
        let ck = CString::new(k).unwrap();
        let cv = CString::new(v).unwrap();
        (self.f_set_option_string)(self.handle, ck.as_ptr(), cv.as_ptr());
    }

    /// Create the OpenGL render context. `get_proc_address`/`ctx` come from ANGLE.
    pub unsafe fn create_render_context(
        &mut self,
        get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
        ctx: *mut c_void,
    ) -> Result<(), String> {
        let mut gl_init = mpv_opengl_init_params {
            get_proc_address,
            get_proc_address_ctx: ctx,
        };
        let api = CString::new("opengl").unwrap();
        let mut advanced: c_int = 1;
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: api.as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                data: &mut gl_init as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_ADVANCED_CONTROL,
                data: &mut advanced as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let mut rc: MpvRenderContext = std::ptr::null_mut();
        let r = (self.f_rc_create)(&mut rc, self.handle, params.as_mut_ptr());
        if r < 0 {
            return Err(format!("mpv_render_context_create failed: {r}"));
        }
        self.render_ctx = rc;
        Ok(())
    }

    pub unsafe fn set_update_callback(
        &self,
        cb: unsafe extern "C" fn(*mut c_void),
        ctx: *mut c_void,
    ) {
        (self.f_rc_set_update_cb)(self.render_ctx, cb, ctx);
    }

    pub unsafe fn update_flags(&self) -> u64 {
        (self.f_rc_update)(self.render_ctx)
    }

    /// Render one frame into `fbo` (0 = the current surface's default FBO).
    pub unsafe fn render(&self, fbo: c_int, w: c_int, h: c_int) {
        let mut ogl_fbo = mpv_opengl_fbo {
            fbo,
            w,
            h,
            internal_format: 0,
        };
        // ANGLE already lands the GL framebuffer into the D3D texture with a
        // top-down orientation, so NO extra flip (FLIP_Y=1 renders upside down).
        let mut flip: c_int = 0;
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_OPENGL_FBO,
                data: &mut ogl_fbo as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_FLIP_Y,
                data: &mut flip as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        (self.f_rc_render)(self.render_ctx, params.as_mut_ptr());
    }

    pub unsafe fn loadfile(&self, url: &str) {
        let load = CString::new("loadfile").unwrap();
        let curl = CString::new(url).unwrap();
        let args = [load.as_ptr(), curl.as_ptr(), std::ptr::null()];
        let r = (self.f_command)(self.handle, args.as_ptr());
        if r < 0 {
            eprintln!("mpv loadfile failed: {r}");
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        unsafe {
            if !self.render_ctx.is_null() {
                (self.f_rc_free)(self.render_ctx);
            }
            if !self.handle.is_null() {
                (self.f_terminate_destroy)(self.handle);
            }
        }
    }
}
