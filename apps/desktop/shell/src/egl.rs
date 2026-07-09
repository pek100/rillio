//! Minimal ANGLE (EGL + GLES2) FFI for Stage 2 of the spike.
//!
//! Goal: get an OpenGL-ES context backed by OUR existing D3D11 device, and a
//! surface whose default framebuffer renders straight into a D3D11 texture we
//! own — so mpv's GL output lands in a texture DirectComposition can present,
//! with no CPU copy. This is the ANGLE "d3d_texture_client_buffer" path.
//!
//! On Windows the Khronos entry points are __stdcall (KHRONOS_APIENTRY), so all
//! EGL/GLES fn pointers are `extern "system"`. mpv's get_proc_address callback,
//! however, is a plain C pointer -> `extern "C"`.

#![allow(non_camel_case_types, dead_code)]

use std::ffi::{c_char, c_void, CString};
use std::ptr::{null, null_mut};

use windows::core::{s, PCSTR, PCWSTR};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

pub type EGLDisplay = *mut c_void;
pub type EGLConfig = *mut c_void;
pub type EGLContext = *mut c_void;
pub type EGLSurface = *mut c_void;
pub type EGLDeviceEXT = *mut c_void;
pub type EGLClientBuffer = *mut c_void;

// EGL constants (subset).
const EGL_NONE: i32 = 0x3038;
const EGL_FALSE: u32 = 0;
const EGL_OPENGL_ES_API: u32 = 0x30A0;
const EGL_PLATFORM_DEVICE_EXT: u32 = 0x313F;
const EGL_D3D11_DEVICE_ANGLE: i32 = 0x33A1;
const EGL_D3D_TEXTURE_ANGLE: u32 = 0x33A3;
const EGL_RENDERABLE_TYPE: i32 = 0x3040;
const EGL_OPENGL_ES2_BIT: i32 = 0x0004;
const EGL_SURFACE_TYPE: i32 = 0x3033;
const EGL_PBUFFER_BIT: i32 = 0x0001;
const EGL_RED_SIZE: i32 = 0x3024;
const EGL_GREEN_SIZE: i32 = 0x3023;
const EGL_BLUE_SIZE: i32 = 0x3022;
const EGL_ALPHA_SIZE: i32 = 0x3021;
const EGL_BIND_TO_TEXTURE_RGBA: i32 = 0x3034;
const EGL_TRUE: i32 = 1;
const EGL_CONTEXT_CLIENT_VERSION: i32 = 0x3098;
const EGL_WIDTH: i32 = 0x3057;
const EGL_HEIGHT: i32 = 0x3056;
const EGL_TEXTURE_FORMAT: i32 = 0x3080;
const EGL_TEXTURE_RGBA: i32 = 0x305E;
const EGL_TEXTURE_TARGET: i32 = 0x3081;
const EGL_TEXTURE_2D: i32 = 0x305F;

// GLES2 constant.
const GL_COLOR_BUFFER_BIT: u32 = 0x00004000;

// --- EGL / GLES function pointer types (stdcall) -------------------------
type PfnGetProcAddress = unsafe extern "system" fn(*const c_char) -> *const c_void;
type PfnGetPlatformDisplayEXT =
    unsafe extern "system" fn(u32, *mut c_void, *const i32) -> EGLDisplay;
type PfnCreateDeviceANGLE =
    unsafe extern "system" fn(i32, *mut c_void, *const i32) -> EGLDeviceEXT;
type PfnInitialize = unsafe extern "system" fn(EGLDisplay, *mut i32, *mut i32) -> u32;
type PfnBindAPI = unsafe extern "system" fn(u32) -> u32;
type PfnChooseConfig =
    unsafe extern "system" fn(EGLDisplay, *const i32, *mut EGLConfig, i32, *mut i32) -> u32;
type PfnCreateContext =
    unsafe extern "system" fn(EGLDisplay, EGLConfig, EGLContext, *const i32) -> EGLContext;
type PfnCreatePbufferFromClientBuffer = unsafe extern "system" fn(
    EGLDisplay,
    u32,
    EGLClientBuffer,
    EGLConfig,
    *const i32,
) -> EGLSurface;
type PfnMakeCurrent =
    unsafe extern "system" fn(EGLDisplay, EGLSurface, EGLSurface, EGLContext) -> u32;
type PfnGetError = unsafe extern "system" fn() -> i32;
type PfnDestroySurface = unsafe extern "system" fn(EGLDisplay, EGLSurface) -> u32;

type PfnGlClearColor = unsafe extern "system" fn(f32, f32, f32, f32);
type PfnGlClear = unsafe extern "system" fn(u32);
type PfnGlViewport = unsafe extern "system" fn(i32, i32, i32, i32);
type PfnGlFinish = unsafe extern "system" fn();

/// Loader + resolver shared with mpv (as the get_proc_address context).
pub struct GlLoader {
    hegl: HMODULE,
    hgles: HMODULE,
    egl_gpa: PfnGetProcAddress,
}

impl GlLoader {
    /// Resolve a GL/EGL symbol: try eglGetProcAddress, then the module exports.
    unsafe fn resolve(&self, name: &str) -> *const c_void {
        let cname = CString::new(name).unwrap();
        let p = (self.egl_gpa)(cname.as_ptr());
        if !p.is_null() {
            return p;
        }
        let pcstr = PCSTR(cname.as_ptr() as *const u8);
        if let Some(f) = GetProcAddress(self.hgles, pcstr) {
            return f as *const c_void;
        }
        if let Some(f) = GetProcAddress(self.hegl, pcstr) {
            return f as *const c_void;
        }
        null()
    }
}

/// The callback mpv calls to resolve GL functions. `ctx` is a `*mut GlLoader`.
pub unsafe extern "C" fn mpv_get_proc_address(ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    let loader = &*(ctx as *const GlLoader);
    let name = std::ffi::CStr::from_ptr(name).to_string_lossy();
    loader.resolve(&name) as *mut c_void
}

pub struct Angle {
    pub display: EGLDisplay,
    pub config: EGLConfig,
    pub context: EGLContext,
    pub loader: Box<GlLoader>,
    make_current: PfnMakeCurrent,
    create_pbuffer: PfnCreatePbufferFromClientBuffer,
    get_error: PfnGetError,
    destroy_surface: PfnDestroySurface,
    // GLES entry points for the Gate-B clear test.
    gl_clear_color: PfnGlClearColor,
    gl_clear: PfnGlClear,
    gl_viewport: PfnGlViewport,
    gl_finish: PfnGlFinish,
}

unsafe fn load_proc<T>(gpa: PfnGetProcAddress, name: &[u8]) -> T {
    let p = gpa(name.as_ptr() as *const c_char);
    assert!(!p.is_null(), "eglGetProcAddress failed for {:?}", std::str::from_utf8(name));
    std::mem::transmute_copy(&p)
}

unsafe fn load_export<T>(h: HMODULE, name: PCSTR) -> T {
    let f = GetProcAddress(h, name).expect("missing export");
    std::mem::transmute_copy(&(f as *const c_void))
}

impl Angle {
    /// Initialise ANGLE on top of an existing ID3D11Device (`d3d11` = raw COM ptr).
    pub unsafe fn init(d3d11: *mut c_void) -> Result<Angle, String> {
        // ANGLE ships next to the exe (copied from the WebView2 runtime).
        let hegl = LoadLibraryW(PCWSTR(wide("libEGL.dll").as_ptr()))
            .map_err(|e| format!("LoadLibrary libEGL.dll: {e}"))?;
        let hgles = LoadLibraryW(PCWSTR(wide("libGLESv2.dll").as_ptr()))
            .map_err(|e| format!("LoadLibrary libGLESv2.dll: {e}"))?;

        let egl_gpa: PfnGetProcAddress = load_export(hegl, s!("eglGetProcAddress"));

        // Core EGL entry points (exported directly).
        let initialize: PfnInitialize = load_export(hegl, s!("eglInitialize"));
        let bind_api: PfnBindAPI = load_export(hegl, s!("eglBindAPI"));
        let choose_config: PfnChooseConfig = load_export(hegl, s!("eglChooseConfig"));
        let create_context: PfnCreateContext = load_export(hegl, s!("eglCreateContext"));
        let make_current: PfnMakeCurrent = load_export(hegl, s!("eglMakeCurrent"));
        let create_pbuffer: PfnCreatePbufferFromClientBuffer =
            load_export(hegl, s!("eglCreatePbufferFromClientBuffer"));
        let get_error: PfnGetError = load_export(hegl, s!("eglGetError"));
        let destroy_surface: PfnDestroySurface = load_export(hegl, s!("eglDestroySurface"));

        // Extension entry points (via eglGetProcAddress).
        let get_platform_display: PfnGetPlatformDisplayEXT =
            load_proc(egl_gpa, b"eglGetPlatformDisplayEXT\0");
        let create_device: PfnCreateDeviceANGLE = load_proc(egl_gpa, b"eglCreateDeviceANGLE\0");

        // Wrap our D3D11 device as an EGL device, then a display on top of it.
        let egl_device = create_device(EGL_D3D11_DEVICE_ANGLE, d3d11, null());
        if egl_device.is_null() {
            return Err(format!("eglCreateDeviceANGLE failed: 0x{:x}", get_error()));
        }
        let display = get_platform_display(EGL_PLATFORM_DEVICE_EXT, egl_device, null());
        if display.is_null() {
            return Err(format!("eglGetPlatformDisplayEXT failed: 0x{:x}", get_error()));
        }
        let (mut major, mut minor) = (0i32, 0i32);
        if initialize(display, &mut major, &mut minor) == EGL_FALSE {
            return Err(format!("eglInitialize failed: 0x{:x}", get_error()));
        }
        eprintln!("ANGLE EGL {major}.{minor} on our D3D11 device");
        bind_api(EGL_OPENGL_ES_API);

        // Config: pbuffer-capable RGBA8. (No BIND_TO_TEXTURE — the D3D texture
        // IS the surface via EGL_ANGLE_d3d_texture_client_buffer, so texture-
        // binding attributes are both unnecessary and rejected on a device
        // display with EGL_BAD_ATTRIBUTE.)
        let cfg_attribs = [
            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
            EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
            EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
            EGL_NONE,
        ];
        let mut config: EGLConfig = null_mut();
        let mut num = 0i32;
        if choose_config(display, cfg_attribs.as_ptr(), &mut config, 1, &mut num) == EGL_FALSE
            || num < 1
        {
            return Err(format!("eglChooseConfig failed: 0x{:x}", get_error()));
        }

        let ctx_attribs = [EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE];
        let context = create_context(display, config, null_mut(), ctx_attribs.as_ptr());
        if context.is_null() {
            return Err(format!("eglCreateContext failed: 0x{:x}", get_error()));
        }

        let loader = Box::new(GlLoader { hegl, hgles, egl_gpa });
        let gl_clear_color: PfnGlClearColor = load_proc(egl_gpa, b"glClearColor\0");
        let gl_clear: PfnGlClear = load_proc(egl_gpa, b"glClear\0");
        let gl_viewport: PfnGlViewport = load_proc(egl_gpa, b"glViewport\0");
        let gl_finish: PfnGlFinish = load_proc(egl_gpa, b"glFinish\0");

        Ok(Angle {
            display,
            config,
            context,
            loader,
            make_current,
            create_pbuffer,
            get_error,
            destroy_surface,
            gl_clear_color,
            gl_clear,
            gl_viewport,
            gl_finish,
        })
    }

    /// Wrap a D3D11 texture (`tex` = raw COM ptr) as a pbuffer surface whose
    /// default framebuffer renders into that texture.
    pub unsafe fn surface_from_texture(&self, tex: *mut c_void, w: i32, h: i32) -> Result<EGLSurface, String> {
        // ANGLE derives size/format from the D3D texture; only width/height are
        // meaningful here. No EGL_TEXTURE_FORMAT/TARGET (that's for bind-tex-image).
        let attribs = [EGL_WIDTH, w, EGL_HEIGHT, h, EGL_NONE];
        let surf = (self.create_pbuffer)(
            self.display,
            EGL_D3D_TEXTURE_ANGLE,
            tex,
            self.config,
            attribs.as_ptr(),
        );
        if surf.is_null() {
            return Err(format!(
                "eglCreatePbufferFromClientBuffer failed: 0x{:x}",
                (self.get_error)()
            ));
        }
        Ok(surf)
    }

    pub unsafe fn make_current(&self, surface: EGLSurface) -> Result<(), String> {
        if (self.make_current)(self.display, surface, surface, self.context) == EGL_FALSE {
            return Err(format!("eglMakeCurrent failed: 0x{:x}", (self.get_error)()));
        }
        Ok(())
    }

    pub unsafe fn destroy_surface(&self, surface: EGLSurface) {
        let _ = (self.destroy_surface)(self.display, surface);
    }

    /// Gate-B smoke test: clear the current surface (fbo 0) to a color.
    pub unsafe fn gl_clear_to(&self, w: i32, h: i32, r: f32, g: f32, b: f32, a: f32) {
        (self.gl_viewport)(0, 0, w, h);
        (self.gl_clear_color)(r, g, b, a);
        (self.gl_clear)(GL_COLOR_BUFFER_BIT);
        (self.gl_finish)();
    }

    pub fn loader_ptr(&self) -> *mut c_void {
        self.loader.as_ref() as *const GlLoader as *mut c_void
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
