//! Standalone dev/test host. Embedders use `rillio_streaming_server::router`
//! instead of this binary.
//!
//! Env:
//!   STREMIO_SERVER_APP_PATH  cache/app dir (default: ./.stremio-server-data)
//!   STREMIO_SERVER_PORT      listen port   (default: 11470)

use std::net::SocketAddr;
use std::path::PathBuf;

use rillio_streaming_server::{serve, Config};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,rillio_streaming_server=debug".into()),
        )
        .init();

    let app_path = std::env::var("STREMIO_SERVER_APP_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./.stremio-server-data"));
    std::fs::create_dir_all(&app_path)?;

    let mut config = Config::local(app_path);
    if let Ok(port) = std::env::var("STREMIO_SERVER_PORT") {
        if let Ok(port) = port.parse::<u16>() {
            config.bind = SocketAddr::from(([127, 0, 0, 1], port));
            config.base_url = url::Url::parse(&format!("http://127.0.0.1:{port}"))
                .expect("port-derived base url is valid");
        }
    }

    serve(config).await
}
