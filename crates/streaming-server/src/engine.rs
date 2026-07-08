//! Torrent engine — a thin wrapper over one librqbit [`Session`] shared across
//! the whole server. Leech-only: no inbound listen port is bound, DHT is on as
//! the peer source, and added-torrent state is not persisted to disk. Mirrors
//! the blob's `dht:false,tracker:false`+explicit-sources posture, except DHT is
//! left on so magnets can find peers (see spec §1.2).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use librqbit::{AddTorrent, ManagedTorrent, Session, SessionOptions};

use crate::storage::ConfinedStorageFactory;
use crate::types;

/// Handle to one managed torrent. librqbit defines this alias internally but
/// does not re-export it, so we mirror it.
pub type Handle = Arc<ManagedTorrent>;

/// How long a create waits for magnet metadata before returning best-effort.
const METADATA_TIMEOUT: Duration = Duration::from_secs(30);

// opts echo (getStatistics.opts) — from the blob's getDefaults merged with our
// settings (server.js:46886-46907). Constant here; these mirror the values M0
// reports in /settings.values.
const OPT_CONNECTIONS: u64 = 55;
const OPT_HANDSHAKE_TIMEOUT: u64 = 20_000;
const OPT_REQUEST_TIMEOUT: u64 = 4_000;
const OPT_SWARM_MIN_PEERS: u64 = 5;
const OPT_SWARM_MAX_SPEED: f64 = 2_621_440.0;
const OPT_GROWLER_PULSE: u64 = 3_670_016;

/// Shared torrent engine handle. Cheap to clone (`Arc` inside).
#[derive(Clone)]
pub struct Engine {
    session: Arc<Session>,
}

impl Engine {
    /// Bootstrap the session rooted at `cache_dir`, unlimited cache. librqbit
    /// lays out per-torrent subfolders beneath it.
    pub async fn new(cache_dir: PathBuf) -> anyhow::Result<Self> {
        Self::with_quota(cache_dir, None).await
    }

    /// Bootstrap with an optional total-bytes cache quota (M1.5).
    ///
    /// All torrent storage goes through [`ConfinedStorageFactory`]: every file
    /// is confined under `cache_dir`, created non-executable, and the total is
    /// capped at `quota_bytes`.
    pub async fn with_quota(cache_dir: PathBuf, quota_bytes: Option<u64>) -> anyhow::Result<Self> {
        let confined = ConfinedStorageFactory::new(&cache_dir, quota_bytes)?.boxed();
        let opts = SessionOptions {
            // DHT on: with trackers off it is the only peer source for a magnet.
            disable_dht: false,
            // No DHT routing-table cache file. A streaming server does not need a
            // persisted peer cache, and the shared cache path otherwise serializes
            // multiple Session instances (e.g. concurrent tests) onto one file.
            disable_dht_persistence: true,
            // None => no inbound TCP listener is bound => leech-only.
            listen_port_range: None,
            enable_upnp_port_forwarding: false,
            // Do not persist added-torrent state across restarts.
            persistence: None,
            // Confine every torrent's writes to the cache (M1.5).
            default_storage_factory: Some(confined),
            ..Default::default()
        };
        let session = Session::new_with_opts(cache_dir, opts).await?;
        Ok(Self { session })
    }

    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }

    /// Add a raw `.torrent` blob (`POST /create`). Metadata is immediate.
    pub async fn add_blob(&self, bytes: Vec<u8>) -> anyhow::Result<Handle> {
        let resp = self
            .session
            .add_torrent(AddTorrent::from_bytes(bytes), None)
            .await?;
        resp.into_handle().context("add_torrent returned list-only")
    }

    /// Get-or-create a torrent from a magnet URL (`POST /:ih/create`, and the
    /// idempotent auto-create on stream). Waits, bounded, for magnet metadata so
    /// files are available for index resolution.
    pub async fn add_magnet(&self, magnet: &str) -> anyhow::Result<Handle> {
        let resp = self
            .session
            .add_torrent(AddTorrent::from_url(magnet), None)
            .await?;
        let handle = resp.into_handle().context("add_torrent returned list-only")?;
        // Bounded wait: a magnet with no reachable peers must not hang the request.
        let _ = tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized()).await;
        Ok(handle)
    }

    /// Lowercase hex infohash of a handle.
    pub fn info_hash_hex(handle: &Handle) -> String {
        format!("{:?}", handle.info_hash()).to_lowercase()
    }

    /// Look up an already-managed torrent by infohash WITHOUT creating one.
    /// Stats routes use this: an unknown infohash yields `null`, not an add.
    pub fn get(&self, info_hash: &str) -> Option<Handle> {
        self.session.with_torrents(|it| {
            it.filter(|(_, h)| Self::info_hash_hex(h) == info_hash)
                .map(|(_, h)| h.clone())
                .next()
        })
    }

    /// Handles of all managed torrents (for the aggregate `/stats.json`).
    pub fn all(&self) -> Vec<Handle> {
        self.session.with_torrents(|it| it.map(|(_, h)| h.clone()).collect())
    }

    // delete_files: removing a torrent also deletes its cached files.
    //
    // The spec suggested keep-files (delete_files=false) to mirror the blob's
    // `destroy`, but librqbit 8.1.1 cannot re-add a torrent whose files still
    // exist in its output folder — the second add fails during init with
    // "setting length for file ...: file is None". Since remove→re-add is a real
    // flow, we delete files: a clean teardown that re-adds cleanly, and the
    // natural meaning of "remove" (free the cache) for a streaming server.
    const DELETE_FILES_ON_REMOVE: bool = true;

    /// Stop and forget a torrent by infohash (`GET /:ih/remove`). No-op if not
    /// managed. Returns whether one was found — the route responds `200 {}`
    /// either way (blob parity).
    pub async fn remove(&self, info_hash: &str) -> bool {
        let target = self.session.with_torrents(|it| {
            it.filter(|(_, h)| Self::info_hash_hex(h) == info_hash)
                .map(|(id, _)| id)
                .next()
        });
        if let Some(id) = target {
            let _ = self.session.delete(id.into(), Self::DELETE_FILES_ON_REMOVE).await;
            true
        } else {
            false
        }
    }

    /// Stop and forget every torrent (`GET /removeAll`).
    pub async fn remove_all(&self) {
        let ids: Vec<librqbit::api::TorrentIdOrHash> =
            self.session.with_torrents(|it| it.map(|(id, _)| id.into()).collect());
        for id in ids {
            let _ = self.session.delete(id, Self::DELETE_FILES_ON_REMOVE).await;
        }
    }

    /// The torrent's files as the wire `File` shape. Empty if metadata is not
    /// yet resolved (magnet still fetching).
    pub fn files(handle: &Handle) -> Vec<types::File> {
        handle
            .with_metadata(|m| {
                m.file_infos
                    .iter()
                    .map(|fi| {
                        let path = fi.relative_filename.to_string_lossy().replace('\\', "/");
                        let name = fi
                            .relative_filename
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| path.clone());
                        types::File {
                            name,
                            path,
                            length: fi.len,
                            offset: fi.offset_in_torrent,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Build the `getStatistics` object (server.js:18294-18338). `idx`, when a
    /// valid file index, merges the per-file `stream*` fields. Swarm/peer
    /// counters are stubbed in M1 and made real in M2.
    pub fn statistics(
        &self,
        handle: &Handle,
        cache_path: String,
        peer_search: types::PeerSearch,
        idx: Option<usize>,
    ) -> types::Statistics {
        let files = Self::files(handle);
        let stats = handle.stats();
        // Live metrics: speeds (Speed.mbps is megabits/s; blob reports bytes/s,
        // ×125_000) and peer counts. `peers` = connected; `queued` = queued.
        let (download_speed, upload_speed, peers, queued) = stats
            .live
            .as_ref()
            .map(|l| {
                (
                    l.download_speed.mbps * 125_000.0,
                    l.upload_speed.mbps * 125_000.0,
                    l.snapshot.peer_stats.live as u64,
                    l.snapshot.peer_stats.queued as u64,
                )
            })
            .unwrap_or((0.0, 0.0, 0, 0));

        let (stream_len, stream_name, stream_progress) = match idx {
            Some(i) => files
                .get(i)
                .map(|f| {
                    let done = stats.file_progress.get(i).copied().unwrap_or(0);
                    let frac = if f.length > 0 {
                        done as f64 / f.length as f64
                    } else {
                        0.0
                    };
                    (f.length, f.name.clone(), frac)
                })
                .unwrap_or((0, String::new(), 0.0)),
            None => (0, String::new(), 0.0),
        };

        types::Statistics {
            name: handle.name().unwrap_or_default(),
            info_hash: Self::info_hash_hex(handle),
            files,
            sources: vec![],
            opts: types::Options {
                connections: Some(OPT_CONNECTIONS),
                dht: false,
                growler: types::Growler {
                    flood: 0,
                    pulse: Some(OPT_GROWLER_PULSE),
                },
                handshake_timeout: Some(OPT_HANDSHAKE_TIMEOUT),
                path: cache_path,
                peer_search,
                swarm_cap: types::SwarmCap {
                    max_speed: Some(OPT_SWARM_MAX_SPEED),
                    min_peers: Some(OPT_SWARM_MIN_PEERS),
                },
                timeout: Some(OPT_REQUEST_TIMEOUT),
                tracker: false,
                r#virtual: true,
            },
            download_speed,
            upload_speed,
            downloaded: stats.progress_bytes,
            uploaded: stats.uploaded_bytes,
            unchoked: 0,
            peers,
            queued,
            unique: 0,
            connection_tries: 0,
            peer_search_running: false,
            stream_len,
            stream_name,
            stream_progress,
            swarm_connections: 0,
            swarm_paused: handle.is_paused(),
            swarm_size: 0,
        }
    }
}

