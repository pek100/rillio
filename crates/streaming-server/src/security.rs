//! Web-origin trust boundary for the loopback control/stream API.
//!
//! Binding to loopback does NOT stop other software on the machine - chiefly any
//! website open in any browser - from reaching `http://127.0.0.1:11470`. Chromium
//! sends the page's true `Origin` on every cross-origin `fetch`/`XHR`/form POST
//! and a page can NEVER forge that header, so an Origin allowlist cleanly
//! separates our trusted desktop WebView from real websites:
//!
//! - A request carrying an **allowlisted** Origin (the Tauri webview) passes and
//!   gets a matching `Access-Control-Allow-Origin` so its JS may read the body.
//! - A request carrying a **foreign** Origin (any real website) is rejected 403
//!   by [`origin_guard`] before the handler runs, and never gets ACAO.
//! - A request with **no** Origin (native mpv, `<video>`/`<img>`/`<track>` media
//!   loads, a direct address-bar navigation) is allowed: it cannot READ a
//!   cross-origin response, and every state-changing route is POST-only, so a
//!   foreign page's `<img src=…>` / navigation (GET, no Origin) cannot drive one.
//!
//! Net effect: a normal website can neither enumerate torrents (`stats.json`) nor
//! trigger mutations (`/create`, `/removeAll`, …), while the desktop app and the
//! native player keep working unchanged.

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};

/// Origins the desktop shell's WebView is served from. On Windows the Tauri v2
/// custom protocol serves the bundled `apps/web` build from `http://tauri.localhost`;
/// the https/`tauri://` variants are listed too so a wry/WebView2 scheme change
/// cannot silently break playback. All three are the trusted shell - never a real
/// website. Extend for dev (a webpack origin, e.g. `http://localhost:8080`) with
/// the `RILLIO_ALLOWED_ORIGIN` env var.
const WEBVIEW_ORIGINS: &[&str] = &[
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
];

fn extra_origin() -> Option<String> {
    std::env::var("RILLIO_ALLOWED_ORIGIN")
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn is_allowed_origin(origin: &HeaderValue) -> bool {
    match origin.to_str() {
        Ok(o) => WEBVIEW_ORIGINS.contains(&o) || extra_origin().as_deref() == Some(o),
        Err(_) => false,
    }
}

/// Reject any request that carries a foreign `Origin`. See the module docs for why
/// no-Origin requests are (necessarily, and safely) allowed.
pub async fn origin_guard(req: Request, next: Next) -> Response {
    if let Some(origin) = req.headers().get(header::ORIGIN) {
        if !is_allowed_origin(origin) {
            tracing::warn!(
                "streaming-server: rejected cross-origin {} {} from Origin {:?}",
                req.method(),
                req.uri(),
                origin
            );
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    next.run(req).await
}

/// CORS for the allowlisted webview only. `AllowOrigin::predicate` echoes the
/// specific matching origin (never `*`), which is also what Chromium's Private
/// Network Access preflight requires alongside `allow_private_network(true)` when
/// the webview (a non-loopback-classified origin) fetches this loopback server.
pub fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _parts| is_allowed_origin(origin)))
        .allow_methods([Method::GET, Method::HEAD, Method::POST, Method::OPTIONS])
        .allow_headers(AllowHeaders::mirror_request())
        .allow_private_network(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ov(s: &str) -> HeaderValue {
        HeaderValue::from_str(s).unwrap()
    }

    #[test]
    fn allows_tauri_webview_origins() {
        assert!(is_allowed_origin(&ov("http://tauri.localhost")));
        assert!(is_allowed_origin(&ov("https://tauri.localhost")));
        assert!(is_allowed_origin(&ov("tauri://localhost")));
    }

    #[test]
    fn rejects_real_websites() {
        assert!(!is_allowed_origin(&ov("https://evil.com")));
        assert!(!is_allowed_origin(&ov("http://localhost:8080"))); // not without the env opt-in
        assert!(!is_allowed_origin(&ov("http://tauri.localhost.evil.com")));
        assert!(!is_allowed_origin(&ov("null")));
    }
}
