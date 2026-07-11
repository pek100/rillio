//! Shared SSRF protection for outbound fetches (`/proxy` + the subtitle /
//! opensub / tracks routes).
//!
//! Two things are enforced here, both fail-loud:
//! - **Destination vetting**: block private / loopback / link-local / CGNAT /
//!   metadata ranges. The media proxy blocks all of them ([`Policy::Strict`]);
//!   the subtitle+opensub routes additionally allow the server's OWN loopback
//!   socket ([`Policy::AllowSelf`]) because their source URLs legitimately point
//!   back at our torrent / proxy routes, but nothing else private.
//! - **Resolve-then-pin**: we resolve the host ONCE, verify every resolved
//!   address, and return a `reqwest::Client` pinned to those exact addresses via
//!   `resolve_to_addrs`. The subsequent connect therefore cannot be redirected to
//!   a different IP by a second DNS answer, closing the resolve/connect TOCTOU +
//!   DNS-rebinding gap. TLS SNI / cert validation still use the original host, so
//!   pinning does not weaken TLS.

use std::net::{IpAddr, SocketAddr};

use axum::http::StatusCode;
use url::Url;

use crate::config::Config;

/// Loopback access an outbound fetch is allowed.
#[derive(Clone, Copy)]
pub(crate) enum Policy {
    /// Block every private / loopback / link-local destination (the media proxy).
    Strict,
    /// Block private ranges, but allow loopback (`127.0.0.0/8`, `::1`) when the
    /// target port is the server's OWN port - the subtitle / opensub routes,
    /// whose `from=` / `videoUrl=` legitimately re-enter our own routes.
    AllowSelf { self_port: u16 },
}

/// Resolve `url`'s host once, enforce `policy` on every resolved address, and
/// return a redirect-disabled `reqwest::Client` pinned to those vetted addresses.
/// Fails loud with a `StatusCode` on any violation (`BAD_REQUEST` for a bad
/// scheme/host, `FORBIDDEN` for a blocked range, `BAD_GATEWAY` for no address).
pub(crate) async fn vet_and_pin(
    cfg: &Config,
    url: &Url,
    policy: Policy,
) -> Result<reqwest::Client, StatusCode> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let host = url.host_str().ok_or(StatusCode::BAD_REQUEST)?;
    let port = url.port_or_known_default().unwrap_or(80);

    // Operator opt-in: exact hosts trusted to resolve into private ranges.
    let host_allowlisted = cfg.proxy_allow_private_hosts.iter().any(|h| h == host);
    let allow_loopback_self = matches!(policy, Policy::AllowSelf { self_port } if self_port == port);

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .collect();
    if addrs.is_empty() {
        return Err(StatusCode::BAD_GATEWAY);
    }

    if !host_allowlisted {
        for addr in &addrs {
            let ip = addr.ip();
            let ok = !is_blocked_ip(ip) || (allow_loopback_self && ip.is_loopback());
            if !ok {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    // Pin: connect to exactly these vetted addresses. `resolve_to_addrs` ignores
    // the port in the SocketAddr and uses the URL's port, but keeps `host` for the
    // Host header + TLS SNI. No second DNS resolution happens.
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Reject destinations resolving to private / loopback / link-local / CGNAT /
/// metadata ranges. Shared by [`vet_and_pin`] and covered by the proxy tests.
pub(crate) fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // CGNAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 0x40)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // unique-local fc00::/7
                || (v6.segments()[0] & 0xFE00) == 0xFC00
                // link-local fe80::/10
                || (v6.segments()[0] & 0xFFC0) == 0xFE80
                // IPv4-mapped: unwrap and re-check
                || v6.to_ipv4_mapped().map(|m| is_blocked_ip(IpAddr::V4(m))).unwrap_or(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssrf_blocks_private_and_loopback() {
        assert!(is_blocked_ip("127.0.0.1".parse().unwrap()));
        assert!(is_blocked_ip("10.0.0.5".parse().unwrap()));
        assert!(is_blocked_ip("192.168.1.1".parse().unwrap()));
        assert!(is_blocked_ip("169.254.169.254".parse().unwrap())); // cloud metadata
        assert!(is_blocked_ip("172.16.0.1".parse().unwrap()));
        assert!(is_blocked_ip("100.64.0.1".parse().unwrap())); // CGNAT
        assert!(is_blocked_ip("::1".parse().unwrap()));
        assert!(is_blocked_ip("fe80::1".parse().unwrap()));
        assert!(is_blocked_ip("fc00::1".parse().unwrap()));
        // public addresses pass
        assert!(!is_blocked_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_blocked_ip("1.1.1.1".parse().unwrap()));
    }
}
