//! Torrent engine — a thin wrapper over one librqbit [`Session`] shared across
//! the whole server. Quiet by default: DHT + injected trackers for peer
//! discovery and batched disk writes, but NO inbound listen port and NO UPnP —
//! we connect outbound to peers without advertising a reachable port, so we are
//! not a discoverable seeder. `RILLIO_TORRENT_LISTEN=1` opts into the louder,
//! marginally-faster-on-rare-titles inbound behavior. A bring-your-own SOCKS5
//! proxy (RILLIO_SOCKS_PROXY) hides the client IP from peers and keeps the
//! inbound port off (no real-IP leak past the proxy). See [`Engine::new`].

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use librqbit::{AddTorrent, ManagedTorrent, Session, SessionOptions, SessionPersistenceConfig};

use crate::{storage, types};

/// Handle to one managed torrent. librqbit defines this alias internally but
/// does not re-export it, so we mirror it.
pub type Handle = Arc<ManagedTorrent>;

/// How long a stream/create waits for a torrent to become streamable before
/// giving up. This must exceed librqbit's initial full-file checksum pass, which
/// for a large title (tens of GiB) can run ~a minute on a fresh add — the
/// torrent stays `Initializing` (not streamable) that whole time. Too short a
/// wait 500s the stream open mid-validation. (Removing that delay entirely is a
/// follow-up: a lazy response body that returns headers immediately and blocks
/// only the body until the torrent goes live.)
const METADATA_TIMEOUT: Duration = Duration::from_secs(180);

/// Default public trackers injected into every torrent, mirroring the blob
/// (server.js:71921 / getDefaults). Without these, DHT is the only peer source
/// and less-popular content gets zero peers; the addon's own trackers are added
/// on top. librqbit supports UDP trackers.
const DEFAULT_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonoid.ch:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.therarbg.to:6969/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://tracker.0x7c0.com:6969/announce",
    "udp://tracker-udp.gbitt.info:80/announce",
    "udp://run.publictracker.xyz:6969/announce",
    "udp://opentracker.io:6969/announce",
    "udp://open.dstud.io:6969/announce",
    "udp://leet-tracker.moe:1337/announce",
    "udp://explodie.org:6969/announce",
    "udp://bt.rer.lol:6969/announce",
];

/// Filename of the persisted torrent preferences, under the cache root. Written
/// by `POST /torrent-settings` (the desktop "faster downloads" toggle), read
/// once at [`Engine::new`].
const TORRENT_PREFS_FILE: &str = "torrent-settings.json";

/// Read the persisted "inbound listen port + UPnP" preference from the cache
/// root. Absent / unreadable / malformed ⇒ `false` (quiet default).
pub fn read_listen_pref(cache_dir: &Path) -> bool {
    std::fs::read(cache_dir.join(TORRENT_PREFS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<types::TorrentSettings>(&bytes).ok())
        .map(|s| s.listen_enabled)
        .unwrap_or(false)
}

/// Persist the "inbound listen port + UPnP" preference. Takes effect on the next
/// [`Engine::new`] (i.e. next server start), since librqbit fixes the listener
/// at session construction.
pub fn write_listen_pref(cache_dir: &Path, listen_enabled: bool) -> std::io::Result<()> {
    let body = serde_json::to_vec(&types::TorrentSettings { listen_enabled })
        .expect("TorrentSettings serializes");
    std::fs::write(cache_dir.join(TORRENT_PREFS_FILE), body)
}

/// Parse a KiB/s rate limit from an env var into librqbit's bytes-per-second
/// `NonZeroU32`. Unset / 0 / invalid ⇒ `None` (uncapped).
fn rate_limit_from_env(var: &str) -> Option<std::num::NonZeroU32> {
    std::env::var(var)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .and_then(|kib| kib.checked_mul(1024))
        .and_then(std::num::NonZeroU32::new)
}

fn add_torrent_options() -> librqbit::AddTorrentOptions {
    librqbit::AddTorrentOptions {
        trackers: Some(DEFAULT_TRACKERS.iter().map(|s| s.to_string()).collect()),
        // Reuse existing cache files instead of failing on them. With
        // allow_overwrite=false librqbit's fs storage opens files with
        // `create_new` (fs.rs), so re-adding a torrent whose files already exist
        // — the normal "close the app, reopen, replay the same title" flow, and
        // any add after a partial download — fails init ("file is None" / "error
        // creating a new file") and the stream 500s. `overwrite: true` opens
        // existing files with truncate(false): the initial checksum pass
        // validates what's on disk and playback RESUMES. Safe under our sandbox —
        // ConfinedStorage still confines every path before init runs, so this
        // only ever reuses files already under the cache root.
        overwrite: true,
        ..Default::default()
    }
}

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
    /// Absolute cache root; torrents whose files would escape it are refused.
    cache_root: Arc<PathBuf>,
}

impl Engine {
    /// Bootstrap the session rooted at `cache_dir`. librqbit lays out per-torrent
    /// subfolders beneath it.
    ///
    /// All torrent storage goes through [`ConfinedStorageFactory`]: every file is
    /// confined under `cache_dir` (path-traversal guard) and created
    /// non-executable. There is no per-torrent size cap — a streaming server
    /// plays a window of a torrent regardless of its total size.
    pub async fn new(cache_dir: PathBuf) -> anyhow::Result<Self> {
        let cache_root = storage::absolutize(&cache_dir)?;

        // Bring-your-own SOCKS5 proxy (privacy): peers see the proxy's IP, not
        // yours. Off unless RILLIO_SOCKS_PROXY is set. NOTE: we never ship a
        // curated proxy list — a stranger's free proxy sees your IP + all traffic
        // and often can't carry UDP (breaks DHT/uTP). Trust is the user's to bring.
        let socks_proxy = std::env::var("RILLIO_SOCKS_PROXY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        // Inbound listen port + UPnP make us reachable by NAT'd/passive seeders —
        // more peers, faster especially on less-seeded titles. But being reachable
        // is also what makes a client a discoverable SEEDER: anti-piracy monitors
        // join a swarm and connect INBOUND to log distributors. Outbound-only
        // leeching still saturates the pipe on well-seeded content (BitTorrent is
        // already multi-source), so the download-speed cost of staying quiet is
        // small while the exposure saved is large. OFF by default.
        //
        // Resolved as: RILLIO_TORRENT_LISTEN env (explicit on/off, a dev escape
        // hatch) ⇒ else the persisted "faster downloads" toggle from the cache
        // root ⇒ else off. A SOCKS5 proxy only tunnels OUTBOUND, so a
        // real-interface listener would leak the real IP past it — the proxy keeps
        // the listener off regardless of the above.
        let listen_requested = match std::env::var("RILLIO_TORRENT_LISTEN").as_deref() {
            Ok("1") | Ok("true") => true,
            Ok("0") | Ok("false") => false,
            _ => read_listen_pref(&cache_dir),
        };
        let listen_enabled = socks_proxy.is_none() && listen_requested;

        let opts = SessionOptions {
            // DHT on: with trackers off it is the only peer source for a magnet.
            disable_dht: false,
            // No DHT routing-table cache file. A streaming server does not need a
            // persisted peer cache, and the shared cache path otherwise serializes
            // multiple Session instances (e.g. concurrent tests) onto one file.
            disable_dht_persistence: true,
            listen_port_range: if listen_enabled { Some(6881..6889) } else { None },
            enable_upnp_port_forwarding: listen_enabled,
            socks_proxy_url: socks_proxy,
            // Batch disk writes (hold up to 32 MiB in memory before flushing) so
            // per-write fsync stalls don't cap throughput once a well-seeded title
            // starts saturating the pipe.
            defer_writes_up_to: Some(32 * 1024 * 1024),
            // Drop dead/slow peers faster so their connection slots recycle to live
            // ones instead of sitting idle on a stalled handshake.
            peer_opts: Some(librqbit::PeerConnectionOptions {
                connect_timeout: Some(Duration::from_secs(10)),
                read_write_timeout: Some(Duration::from_secs(60)),
                keep_alive_interval: None,
            }),
            // Optional rate caps (KiB/s via env, uncapped by default). A modest
            // UPLOAD cap is the useful one: on an asymmetric link, a saturated
            // upstream delays the TCP ACKs for your downloads, so capping upload
            // can raise DOWNLOAD throughput. Download cap is there for parity.
            ratelimits: librqbit::limits::LimitsConfig {
                upload_bps: rate_limit_from_env("RILLIO_UPLOAD_LIMIT_KBPS"),
                download_bps: rate_limit_from_env("RILLIO_DOWNLOAD_LIMIT_KBPS"),
            },
            // Persist torrent state + fast-resume so a restart RESUMES instantly
            // instead of re-hashing the whole file (~a minute for a 31 GiB title).
            // librqbit's persistence store type-checks for its native
            // FilesystemStorageFactory, so we use that (default_storage_factory
            // None) rather than a wrapper. Path confinement is instead asserted at
            // add time ([`Engine::assert_confined`]) and already enforced by
            // librqbit-core (parse-time ".." rejection). See storage.rs.
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(cache_dir.join("session")),
            }),
            fastresume: true,
            default_storage_factory: None,
            ..Default::default()
        };
        let session = Session::new_with_opts(cache_dir, opts).await?;
        Ok(Self { session, cache_root: Arc::new(cache_root) })
    }

    /// Refuse a torrent whose files would resolve outside the cache root. A
    /// belt-and-suspenders assertion over librqbit-core's own parse-time
    /// rejection; a no-op until the torrent's metadata has resolved.
    fn assert_confined(&self, handle: &Handle) -> anyhow::Result<()> {
        let files: Vec<PathBuf> = handle
            .with_metadata(|m| m.file_infos.iter().map(|fi| fi.relative_filename.clone()).collect())
            .unwrap_or_default();
        storage::assert_confined(&self.cache_root, files.iter().map(PathBuf::as_path))
    }

    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }

    /// Add a raw `.torrent` blob (`POST /create`). Metadata is immediate.
    pub async fn add_blob(&self, bytes: Vec<u8>) -> anyhow::Result<Handle> {
        let resp = self
            .session
            .add_torrent(AddTorrent::from_bytes(bytes), Some(add_torrent_options()))
            .await?;
        let handle = resp.into_handle().context("add_torrent returned list-only")?;
        self.reject_if_unconfined(&handle).await?;
        Ok(handle)
    }

    /// Tear the torrent back down (and its files) if it escapes the cache.
    async fn reject_if_unconfined(&self, handle: &Handle) -> anyhow::Result<()> {
        if let Err(e) = self.assert_confined(handle) {
            self.remove(&Self::info_hash_hex(handle)).await;
            return Err(e);
        }
        Ok(())
    }

    /// Get-or-create a torrent from a magnet URL (`POST /:ih/create`, and the
    /// idempotent auto-create on stream). Waits, bounded, for magnet metadata so
    /// files are available for index resolution.
    pub async fn add_magnet(&self, magnet: &str) -> anyhow::Result<Handle> {
        let resp = self
            .session
            .add_torrent(AddTorrent::from_url(magnet), Some(add_torrent_options()))
            .await?;
        let handle = resp.into_handle().context("add_torrent returned list-only")?;
        // Bounded wait: a magnet with no reachable peers must not hang the request.
        let _ = tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized()).await;
        self.reject_if_unconfined(&handle).await?;
        Ok(handle)
    }

    /// Get-or-create by infohash for the stream route. Crucially, if the torrent
    /// is already managed it returns the LIVE handle without re-adding: the media
    /// player opens many connections per title (header read, mkv-index seek,
    /// read-ahead), and calling `add_torrent` again on a live torrent resets it
    /// to the `initializing` state (`overwrite: true` re-runs storage init),
    /// which makes the concurrent stream reads fail with "invalid state:
    /// initializing" and playback abort. Only a genuinely new infohash adds.
    pub async fn get_or_create(&self, info_hash: &str) -> anyhow::Result<Handle> {
        if let Some(handle) = self.get(info_hash) {
            // Already managed: make sure metadata is ready, but never re-add.
            let _ = tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized()).await;
            return Ok(handle);
        }
        let magnet = format!("magnet:?xt=urn:btih:{info_hash}");
        self.add_magnet(&magnet).await
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

#[cfg(test)]
mod tests {
    use super::{read_listen_pref, write_listen_pref, TORRENT_PREFS_FILE};

    /// Each test gets its own dir so parallel runs don't clobber the shared file.
    fn fresh_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rillio-torrent-prefs-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn absent_pref_is_quiet_default() {
        assert!(!read_listen_pref(&fresh_dir("absent")));
    }

    #[test]
    fn pref_roundtrips_both_ways() {
        let dir = fresh_dir("roundtrip");
        write_listen_pref(&dir, true).unwrap();
        assert!(read_listen_pref(&dir));
        write_listen_pref(&dir, false).unwrap();
        assert!(!read_listen_pref(&dir));
    }

    #[test]
    fn malformed_pref_falls_back_to_off() {
        let dir = fresh_dir("malformed");
        std::fs::write(dir.join(TORRENT_PREFS_FILE), b"{ not valid json").unwrap();
        assert!(!read_listen_pref(&dir));
    }
}

