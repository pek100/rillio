//! Native Stremio desktop shell — owns the WebView2 (composition mode) so mpv
//! video and the transparent web UI are GPU-composited via DirectComposition.
//! See memory/compositing-dcomp-plan.md. Proven in spikes/dcomp-webview.
//!
//! Stage 3a (this file): the skeleton — a Win32 window + D3D11 + DirectComposition
//! + a composition-mode WebView2 loading the REAL apps/web build (served from a
//! virtual host), with the embedded Rust streaming server running in-process.
//! The video layer is a teal placeholder here; 3b swaps it for the mpv render
//! pipeline (egl.rs + mpvffi.rs are already vendored for that).

// Vendored from the spike, wired up in 3b.
#[allow(dead_code)]
mod egl;
#[allow(dead_code)]
mod mpvffi;

use std::iter::once;
use std::path::PathBuf;
use std::sync::mpsc;

use windows::core::{Interface, PCWSTR, Result};
use windows::Win32::Foundation::{E_FAIL, E_POINTER, HMODULE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView, ID3D11Texture2D,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_UNKNOWN, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_PRESENT, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_CHAIN_FLAG, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{SetProcessDpiAwareness, PROCESS_PER_MONITOR_DPI_AWARE};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW,
    GetWindowLongPtrW, LoadCursorW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, ShowWindow,
    TranslateMessage, CW_USEDEFAULT, GWLP_USERDATA, IDC_ARROW, MSG, SW_SHOW, WM_DESTROY,
    WM_ERASEBKGND, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
    WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SIZE, WNDCLASSW,
    WS_OVERLAPPEDWINDOW,
};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2Environment, ICoreWebView2CompositionController, ICoreWebView2Controller,
    ICoreWebView2Controller2, ICoreWebView2Environment, ICoreWebView2Environment3, ICoreWebView2_3,
    COREWEBVIEW2_COLOR, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW, COREWEBVIEW2_MOUSE_EVENT_KIND,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS,
};
use webview2_com::{
    CreateCoreWebView2CompositionControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler,
};

const VIRTUAL_HOST: &str = "stremio.local";

struct AppState {
    comp_controller: ICoreWebView2CompositionController,
    controller: ICoreWebView2Controller,
    dcomp: IDCompositionDevice,
    swapchain: IDXGISwapChain1,
    d3d: ID3D11Device,
    ctx: ID3D11DeviceContext,
    _target: IDCompositionTarget,
    _root: IDCompositionVisual,
    _video_visual: IDCompositionVisual,
    _web_visual: IDCompositionVisual,
}

impl AppState {
    unsafe fn paint_placeholder(&self) -> Result<()> {
        let backbuf: ID3D11Texture2D = self.swapchain.GetBuffer(0)?;
        let mut rtv: Option<ID3D11RenderTargetView> = None;
        self.d3d.CreateRenderTargetView(&backbuf, None, Some(&mut rtv))?;
        let rtv = rtv.unwrap();
        self.ctx.ClearRenderTargetView(&rtv, &[0.02, 0.30, 0.36, 1.0]);
        self.swapchain.Present(1, DXGI_PRESENT(0)).ok()?;
        Ok(())
    }

    unsafe fn resize(&self, w: i32, h: i32) {
        if w <= 0 || h <= 0 {
            return;
        }
        let _ = self
            .swapchain
            .ResizeBuffers(0, w as u32, h as u32, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG(0));
        let _ = self.paint_placeholder();
        let _ = self.controller.SetBounds(RECT { left: 0, top: 0, right: w, bottom: h });
        let _ = self.dcomp.Commit();
    }
}

fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,stremio_streaming_server=info".into()),
        )
        .try_init();

    start_streaming_server();

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let _ = SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);

        let hwnd = create_window()?;
        let (w, h) = client_size(hwnd);

        // --- D3D11 + composition swapchain (teal placeholder video layer) --
        let mut d3d: Option<ID3D11Device> = None;
        let mut ctx: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut d3d),
            Some(&mut D3D_FEATURE_LEVEL::default()),
            Some(&mut ctx),
        )?;
        let d3d = d3d.unwrap();
        let ctx = ctx.unwrap();
        let dxgi_dev: IDXGIDevice = d3d.cast()?;
        let adapter = dxgi_dev.GetAdapter()?;
        let factory: IDXGIFactory2 = adapter.GetParent()?;
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: w as u32,
            Height: h as u32,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            Stereo: false.into(),
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_IGNORE,
            Flags: 0,
        };
        let swapchain = factory.CreateSwapChainForComposition(&d3d, &desc, None)?;

        let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi_dev)?;
        let target = dcomp.CreateTargetForHwnd(hwnd, true)?;
        let root = dcomp.CreateVisual()?;
        target.SetRoot(&root)?;
        let video_visual = dcomp.CreateVisual()?;
        video_visual.SetContent(&swapchain)?;
        root.AddVisual(&video_visual, true, None)?;
        let web_visual = dcomp.CreateVisual()?;
        root.AddVisual(&web_visual, true, &video_visual)?;

        // --- composition-mode WebView2 hosting the real web app ------------
        let environment = create_environment()?;
        let env3: ICoreWebView2Environment3 = environment.cast()?;
        let comp_controller = create_comp_controller(&env3, hwnd)?;
        comp_controller.SetRootVisualTarget(&web_visual)?;
        let controller: ICoreWebView2Controller = comp_controller.cast()?;
        controller.SetBounds(RECT { left: 0, top: 0, right: w, bottom: h })?;
        controller.SetIsVisible(true)?;
        let controller2: ICoreWebView2Controller2 = controller.cast()?;
        controller2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 })?;

        let webview = controller.CoreWebView2()?;
        let webview3: ICoreWebView2_3 = webview.cast()?;
        let web_dir = web_dir();
        tracing::info!("serving web app from {web_dir:?} at https://{VIRTUAL_HOST}/");
        webview3.SetVirtualHostNameToFolderMapping(
            PCWSTR(wide(VIRTUAL_HOST).as_ptr()),
            PCWSTR(wide(&web_dir.to_string_lossy()).as_ptr()),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW,
        )?;
        let url = format!("https://{VIRTUAL_HOST}/index.html");
        webview.Navigate(PCWSTR(wide(&url).as_ptr()))?;

        let state = Box::new(AppState {
            comp_controller,
            controller,
            dcomp: dcomp.clone(),
            swapchain,
            d3d,
            ctx,
            _target: target,
            _root: root,
            _video_visual: video_visual,
            _web_visual: web_visual,
        });
        state.paint_placeholder()?;
        dcomp.Commit()?;

        SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(state) as isize);
        let _ = ShowWindow(hwnd, SW_SHOW);
        tracing::info!("shell up — loading {url}");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

/// Spawn the embedded streaming server on its own tokio runtime thread. Binds
/// 127.0.0.1:11470 and owns the torrent cache under the app data dir (shared
/// with the Tauri build so cache/fastresume carry over).
fn start_streaming_server() {
    std::thread::spawn(|| {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(async {
            let cache = app_data_dir().join("streaming-server");
            if let Err(e) = std::fs::create_dir_all(&cache) {
                tracing::error!("cannot create cache dir {cache:?}: {e}");
            }
            let cfg = stremio_streaming_server::Config::local(cache);
            if let Err(e) = stremio_streaming_server::serve(cfg).await {
                tracing::error!("streaming server exited: {e}");
            }
        });
    });
}

fn app_data_dir() -> PathBuf {
    // Windows: %APPDATA% is the Roaming dir; match the Tauri identifier so the
    // torrent cache + fastresume state carry over.
    let base = std::env::var("APPDATA").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into());
    PathBuf::from(base).join("com.stremio.desktop")
}

fn web_dir() -> PathBuf {
    let raw = std::env::var("STREMIO_WEB_DIR")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "\\..\\..\\web\\build").to_string());
    match std::fs::canonicalize(&raw) {
        Ok(p) => PathBuf::from(strip_unc(&p.to_string_lossy())),
        Err(_) => PathBuf::from(raw),
    }
}

/// Strip the Windows \\?\ verbatim prefix (WebView2 dislikes it).
fn strip_unc(p: &str) -> String {
    p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppState;
        let state = if state_ptr.is_null() { None } else { Some(&*state_ptr) };
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_SIZE => {
                if let Some(state) = state {
                    let w = (lparam.0 & 0xffff) as i32;
                    let h = ((lparam.0 >> 16) & 0xffff) as i32;
                    state.resize(w, h);
                }
                LRESULT(0)
            }
            WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN
            | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP => {
                if let Some(state) = state {
                    let x = (lparam.0 & 0xffff) as i16 as i32;
                    let y = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
                    let vkeys = (wparam.0 & 0xffff) as i32;
                    let _ = state.comp_controller.SendMouseInput(
                        COREWEBVIEW2_MOUSE_EVENT_KIND(msg as i32),
                        COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(vkeys),
                        0,
                        POINT { x, y },
                    );
                }
                LRESULT(0)
            }
            WM_MOUSEWHEEL => {
                if let Some(state) = state {
                    let sx = (lparam.0 & 0xffff) as i16 as i32;
                    let sy = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
                    let mut pt = POINT { x: sx, y: sy };
                    let _ = windows::Win32::Graphics::Gdi::ScreenToClient(hwnd, &mut pt);
                    let delta = ((wparam.0 >> 16) & 0xffff) as i16 as i32;
                    let vkeys = (wparam.0 & 0xffff) as i32;
                    let _ = state.comp_controller.SendMouseInput(
                        COREWEBVIEW2_MOUSE_EVENT_KIND(msg as i32),
                        COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(vkeys),
                        delta as u32,
                        pt,
                    );
                }
                LRESULT(0)
            }
            WM_DESTROY => {
                if !state_ptr.is_null() {
                    drop(Box::from_raw(state_ptr));
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                }
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

unsafe fn create_window() -> Result<HWND> {
    let hinstance = GetModuleHandleW(None)?;
    let class_name = wide("StremioShell");
    let title = wide("Stremio");
    let class = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: hinstance.into(),
        hCursor: LoadCursorW(None, IDC_ARROW)?,
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };
    RegisterClassW(&class);
    let hwnd = CreateWindowExW(
        Default::default(),
        PCWSTR(class_name.as_ptr()),
        PCWSTR(title.as_ptr()),
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        1280,
        800,
        None,
        None,
        Some(hinstance.into()),
        None,
    )?;
    Ok(hwnd)
}

fn create_environment() -> Result<ICoreWebView2Environment> {
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(|handler| unsafe {
            CreateCoreWebView2Environment(&handler).map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, environment| {
            error_code?;
            tx.send(environment.ok_or_else(|| windows::core::Error::from(E_POINTER)))
                .expect("send env");
            Ok(())
        }),
    )
    .map_err(to_win_err)?;
    rx.recv().expect("recv env")
}

fn create_comp_controller(
    env3: &ICoreWebView2Environment3,
    hwnd: HWND,
) -> Result<ICoreWebView2CompositionController> {
    let (tx, rx) = mpsc::channel();
    let env3 = env3.clone();
    CreateCoreWebView2CompositionControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            env3.CreateCoreWebView2CompositionController(hwnd, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, controller| {
            error_code?;
            tx.send(controller.ok_or_else(|| windows::core::Error::from(E_POINTER)))
                .expect("send comp controller");
            Ok(())
        }),
    )
    .map_err(to_win_err)?;
    rx.recv().expect("recv comp controller")
}

unsafe fn client_size(hwnd: HWND) -> (i32, i32) {
    let mut r = RECT::default();
    let _ = GetClientRect(hwnd, &mut r);
    (r.right - r.left, r.bottom - r.top)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(once(0)).collect()
}

fn to_win_err(e: webview2_com::Error) -> windows::core::Error {
    match e {
        webview2_com::Error::WindowsError(w) => w,
        other => {
            tracing::error!("webview2 error: {other:?}");
            windows::core::Error::from(E_FAIL)
        }
    }
}
