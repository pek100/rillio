//! Torrent engine — a thin wrapper over one librqbit [`Session`] shared across
//! the whole server. Leech-only: no inbound listen port is bound, DHT is on as
//! the peer source, and added-torrent state is not persisted to disk. Mirrors
//! the blob's `dht:false,tracker:false`+explicit-sources posture, except DHT is
//! left on so magnets can find peers (see spec §1.2).

use std::path::PathBuf;
use std::sync::Arc;

use librqbit::{Session, SessionOptions};

/// Shared torrent engine handle. Cheap to clone (`Arc` inside).
#[derive(Clone)]
pub struct Engine {
    session: Arc<Session>,
}

impl Engine {
    /// Bootstrap the session rooted at `cache_dir`. librqbit lays out per-torrent
    /// subfolders beneath it.
    pub async fn new(cache_dir: PathBuf) -> anyhow::Result<Self> {
        let opts = SessionOptions {
            // DHT on: with trackers off it is the only peer source for a magnet.
            disable_dht: false,
            // None => no inbound TCP listener is bound => leech-only.
            listen_port_range: None,
            enable_upnp_port_forwarding: false,
            // Do not persist added-torrent state across restarts.
            persistence: None,
            ..Default::default()
        };
        let session = Session::new_with_opts(cache_dir, opts).await?;
        Ok(Self { session })
    }

    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }
}
