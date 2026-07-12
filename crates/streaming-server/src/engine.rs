//! Torrent engine - a thin wrapper over one librqbit [`Session`] shared across
//! the whole server. Quiet by default: DHT + injected trackers for peer
//! discovery and batched disk writes, but NO inbound listen port and NO UPnP -
//! we connect outbound to peers without advertising a reachable port, so we are
//! not a discoverable seeder. `RILLIO_TORRENT_LISTEN=1` opts into the louder,
//! marginally-faster-on-rare-titles inbound behavior. A bring-your-own SOCKS5
//! proxy (RILLIO_SOCKS_PROXY) hides the client IP from peers and keeps the
//! inbound port off (no real-IP leak past the proxy). See [`Engine::new`].

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;
use librqbit::{
    torrent_from_bytes, AddTorrent, ByteBuf, ManagedTorrent, Session, SessionOptions,
    SessionPersistenceConfig,
};

use crate::{storage, types};

/// Handle to one managed torrent. librqbit defines this alias internally but
/// does not re-export it, so we mirror it.
pub type Handle = Arc<ManagedTorrent>;

/// How long a stream/create waits for a torrent to become streamable before
/// giving up. This must exceed librqbit's initial full-file checksum pass, which
/// for a large title (tens of GiB) can run ~a minute on a fresh add - the
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
        // - the normal "close the app, reopen, replay the same title" flow, and
        // any add after a partial download - fails init ("file is None" / "error
        // creating a new file") and the stream 500s. `overwrite: true` opens
        // existing files with truncate(false): the initial checksum pass
        // validates what's on disk and playback RESUMES. Safe under our sandbox -
        // ConfinedStorage still confines every path before init runs, so this
        // only ever reuses files already under the cache root.
        overwrite: true,
        ..Default::default()
    }
}

/// BitTorrent tuning knobs the web's torrent-profile selector drives (POST
/// `/settings`) and `GET /settings` reports back, and which the stats `opts`
/// echo reflects.
///
/// IMPORTANT - librqbit 8.1.1 can only honor ONE of these for real: the
/// download-speed HARD limit, applied as the session-wide download rate cap
/// (`Session::ratelimits`, live-tunable via `set_download_bps`). The rest are
/// stored and reported so the profile selector round-trips, but librqbit has NO
/// knob for them, so they are documented as report-only rather than silently
/// pretended-applied (fail loud):
///   - `max_connections`: librqbit hardcodes a 128 live-peer semaphore
///     (`torrent_state/live`: `Semaphore::new(128)`); no public override exists.
///   - soft limit / min_peers / handshake+request timeouts: no librqbit analog.
/// See [`Engine::apply_bt_profile`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BtProfile {
    pub max_connections: u64,
    pub handshake_timeout: u64,
    pub request_timeout: u64,
    pub download_speed_soft_limit: f64,
    pub download_speed_hard_limit: f64,
    pub min_peers_for_stable: u64,
}

impl BtProfile {
    /// Aggressive default so a fresh install downloads fast out of the box.
    /// Byte-for-byte the web `TORRENT_PROFILES["ultra fast"]` entry, so a clean
    /// profile shows "ultra fast" (not "custom") in Settings.
    pub const ULTRA_FAST: BtProfile = BtProfile {
        max_connections: 400,
        handshake_timeout: 25_000,
        request_timeout: 6_000,
        download_speed_soft_limit: 8_388_608.0,
        download_speed_hard_limit: 78_643_200.0,
        min_peers_for_stable: 10,
    };
}

/// Clamp a bytes/sec download cap (an `f64` from the web profile) to librqbit's
/// `NonZeroU32`. Non-finite / sub-1-byte => `None` (uncapped).
fn download_bps_from(bytes_per_sec: f64) -> Option<std::num::NonZeroU32> {
    if !bytes_per_sec.is_finite() || bytes_per_sec < 1.0 {
        return None;
    }
    std::num::NonZeroU32::new(bytes_per_sec.min(u32::MAX as f64) as u32)
}

/// Insert `(info_hash, file_id)` into the prefetch-dedup set, returning `true`
/// only if it was newly inserted (i.e. the caller owns the one prefetch for that
/// pair). A poisoned lock yields `false` (skip - the prefetch is best-effort).
/// Split out from [`Engine::mark_prefetch`] so the dedup logic is unit-testable
/// without standing up a full librqbit session.
fn mark_prefetch_in(
    set: &Mutex<HashSet<(String, usize)>>,
    info_hash: &str,
    file_id: usize,
) -> bool {
    match set.lock() {
        Ok(mut s) => s.insert((info_hash.to_owned(), file_id)),
        Err(_) => false,
    }
}

/// Shared torrent engine handle. Cheap to clone (`Arc` inside).
#[derive(Clone)]
pub struct Engine {
    session: Arc<Session>,
    /// Absolute cache root; torrents whose files would escape it are refused.
    cache_root: Arc<PathBuf>,
    /// Last time each torrent (by lowercase hex infohash) was streamed or queried.
    /// Drives cache-cap eviction: least-recently-used torrents go first, and a
    /// recently-touched (i.e. currently-playing) one is protected. See
    /// [`Engine::touch`] and [`Engine::enforce_cache_cap`].
    last_access: Arc<Mutex<HashMap<String, Instant>>>,
    /// (infohash, file_id) pairs whose tail (MKV Cues) has already been
    /// prefetched, so we warm each file's Cues at most once per session. See
    /// [`Engine::mark_prefetch`] and the tail-prefetch in stream.rs.
    prefetched: Arc<Mutex<HashSet<(String, usize)>>>,
    /// Current BitTorrent tuning profile (the web torrent-profile selector).
    /// Only its download HARD limit is live-applied to the session; the rest is
    /// stored for `/settings` reporting and the stats `opts` echo. See
    /// [`BtProfile`] and [`Engine::apply_bt_profile`].
    bt: Arc<Mutex<BtProfile>>,
    /// Lowercase hex infohashes the user chose to KEEP ("download to cache"):
    /// the cache-cap sweeper never evicts these. Persisted to
    /// [`PINS_FILE`] in the cache root, loaded at [`Engine::new`].
    pinned: Arc<Mutex<HashSet<String>>>,
}

/// Filename of the persisted pin set, under the cache root.
const PINS_FILE: &str = "pins.json";

/// Read the persisted pin set. Absent/unreadable/malformed => empty (nothing
/// pinned) - pins are cache-keeping hints, not integrity data.
fn read_pins(cache_dir: &std::path::Path) -> HashSet<String> {
    std::fs::read(cache_dir.join(PINS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

/// Persist the pin set. Loud on failure: an unsaved pin silently un-pins on the
/// next start, which the sweeper could then evict.
fn write_pins(cache_dir: &std::path::Path, pins: &HashSet<String>) {
    let list: Vec<&String> = pins.iter().collect();
    let body = serde_json::to_vec(&list).expect("pin list serializes");
    if let Err(e) = std::fs::write(cache_dir.join(PINS_FILE), body) {
        tracing::error!("pins: persisting {PINS_FILE} failed: {e}");
    }
}

// ---------------------------------------------------------------------------
// Stale-fastresume guard
// ---------------------------------------------------------------------------
//
// librqbit 8.1.1 persists per-torrent fastresume under `<cache_root>/session/`:
// `session.json` (per-torrent output_folder), `<infohash>.bitv` (the raw
// BitTorrent have-bitfield, Msb0) and `<infohash>.torrent` (metainfo). On
// restore it TRUSTS the .bitv unconditionally: if the bitfield says "have all"
// but the data files at output_folder are gone (moved/deleted externally),
// librqbit preallocates fresh zero-filled files, reports the torrent 100%
// complete, and the stream route serves gigabytes of zeros (mpv dies with
// "unrecognized file format"). Silent corruption; the guard below runs BEFORE
// the Session is constructed and deletes the .bitv of any torrent whose claimed
// progress provably has no data behind it, forcing a clean re-download instead.

/// How many bytes of a file's head (and tail) the zero-prealloc check samples.
/// Never full reads: 64 KiB from each end is enough to tell a preallocated
/// zero-filled file from real media (which always has nonzero structure).
const ZERO_SAMPLE_LEN: u64 = 64 * 1024;

/// One torrent entry of librqbit's `session/session.json`, reduced to the two
/// fields the guard needs. Unknown fields are ignored, and the file itself is
/// never rewritten, so the rest of the entry stays untouched.
#[derive(serde::Deserialize)]
struct PersistedTorrentEntry {
    info_hash: String,
    output_folder: PathBuf,
}

/// The `session.json` shape (`{"torrents": {"<id>": {...}}}`).
#[derive(serde::Deserialize)]
struct PersistedSessionDb {
    torrents: HashMap<String, PersistedTorrentEntry>,
}

fn bitv_path(session_dir: &Path, info_hash: &str) -> PathBuf {
    session_dir.join(format!("{info_hash}.bitv"))
}

/// Whether the raw bitfield claims EVERY piece is downloaded. BitTorrent
/// bitfields are Msb0 (piece 0 = highest bit of byte 0); trailing pad bits of
/// the last byte are ignored.
fn bitv_claims_all_pieces(bitv: &[u8], num_pieces: usize) -> bool {
    if num_pieces == 0 {
        return false;
    }
    let full_bytes = num_pieces / 8;
    let rem_bits = num_pieces % 8;
    if bitv.len() < full_bytes + usize::from(rem_bits > 0) {
        return false;
    }
    if !bitv[..full_bytes].iter().all(|&b| b == 0xFF) {
        return false;
    }
    if rem_bits > 0 {
        let mask = 0xFFu8 << (8 - rem_bits);
        if bitv[full_bytes] & mask != mask {
            return false;
        }
    }
    true
}

/// Sample the first and last [`ZERO_SAMPLE_LEN`] bytes of `path`. `true` means
/// every sampled byte is zero, i.e. the file looks like a fresh preallocation
/// rather than downloaded data. Errors propagate (caller keeps the fastresume
/// when it cannot verify).
fn file_head_tail_all_zeros(path: &Path) -> anyhow::Result<bool> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).with_context(|| format!("opening {path:?}"))?;
    let len = f.metadata().with_context(|| format!("stat {path:?}"))?.len();
    if len == 0 {
        // An existing but empty file carries no data; equivalent to all-zero.
        return Ok(true);
    }
    let head = len.min(ZERO_SAMPLE_LEN) as usize;
    let mut buf = vec![0u8; head];
    f.read_exact(&mut buf).with_context(|| format!("reading head of {path:?}"))?;
    if buf.iter().any(|&b| b != 0) {
        return Ok(false);
    }
    if len > ZERO_SAMPLE_LEN {
        let tail = ZERO_SAMPLE_LEN.min(len - ZERO_SAMPLE_LEN) as usize;
        f.seek(SeekFrom::End(-(tail as i64)))
            .with_context(|| format!("seeking tail of {path:?}"))?;
        let mut buf = vec![0u8; tail];
        f.read_exact(&mut buf).with_context(|| format!("reading tail of {path:?}"))?;
        if buf.iter().any(|&b| b != 0) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Decide whether one torrent's fastresume is provably stale. Returns
/// `Some(reason)` when the .bitv must be invalidated, `None` to keep it, and
/// `Err` when it cannot be verified (caller keeps it and warns).
///
/// Deliberately conservative, two rules only:
/// 1. The .bitv claims progress (any bit set) but NONE of the torrent's
///    payload files exist at the recorded output_folder: a fully absent
///    download. Partially-moved trees (some files still present) are kept.
/// 2. The .bitv claims EVERY piece, all payload files exist, and every one of
///    them samples all-zero at head and tail: the zero-preallocated corpse a
///    previous run left behind after trusting rule-1 state. A false positive
///    here only costs a re-hash/re-download; the data files themselves are
///    never touched.
fn check_fastresume_stale(
    session_dir: &Path,
    entry: &PersistedTorrentEntry,
) -> anyhow::Result<Option<&'static str>> {
    let bitv_bytes = match std::fs::read(bitv_path(session_dir, &entry.info_hash)) {
        Ok(b) => b,
        // No fastresume, nothing to invalidate.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).context("reading .bitv"),
    };
    if bitv_bytes.iter().all(|&b| b == 0) {
        // Claims no progress; a full initial check runs anyway.
        return Ok(None);
    }

    let torrent_file = session_dir.join(format!("{}.torrent", entry.info_hash));
    let torrent_raw = std::fs::read(&torrent_file)
        .with_context(|| format!("reading {torrent_file:?} (cannot enumerate expected files)"))?;
    let meta = torrent_from_bytes::<ByteBuf>(&torrent_raw)
        .with_context(|| format!("parsing {torrent_file:?}"))?;

    // Payload files only: bep-47 padding files are never written to disk, and
    // zero-length files prove nothing about downloaded data.
    let files: Vec<PathBuf> = meta
        .info
        .iter_file_details()
        .context("listing torrent files")?
        .filter(|fd| !fd.attrs().padding && fd.len > 0)
        .map(|fd| fd.filename.to_pathbuf())
        .collect::<anyhow::Result<_>>()?;
    if files.is_empty() {
        return Ok(None);
    }

    let existing: Vec<PathBuf> = files
        .iter()
        .map(|rel| entry.output_folder.join(rel))
        .filter(|p| p.is_file())
        .collect();
    if existing.is_empty() {
        return Ok(Some("no data files exist at the recorded output folder"));
    }

    let num_pieces = meta.info.pieces.as_ref().len() / 20;
    if existing.len() == files.len() && bitv_claims_all_pieces(&bitv_bytes, num_pieces) {
        for path in &existing {
            if !file_head_tail_all_zeros(path)? {
                return Ok(None);
            }
        }
        return Ok(Some(
            "bitfield claims complete but every data file samples all-zero (stale preallocation)",
        ));
    }
    Ok(None)
}

/// Startup guard: walk `session.json` and delete the `.bitv` of every torrent
/// whose fastresume is provably stale (see [`check_fastresume_stale`]), so the
/// librqbit [`Session`] constructed right after never trusts it. The
/// `.torrent` file stays so metadata survives and the torrent re-adds without
/// a magnet round-trip; librqbit then runs a fresh initial check and
/// re-downloads instead of serving zeros. Every invalidation and every
/// entry that cannot be verified is logged loudly.
fn invalidate_stale_fastresume(session_dir: &Path) {
    let db_path = session_dir.join("session.json");
    let raw = match std::fs::read(&db_path) {
        Ok(b) => b,
        // Fresh install / first boot: no persisted session, nothing to guard.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            tracing::warn!("fastresume-guard: cannot read {db_path:?}: {e}; skipping guard");
            return;
        }
    };
    let db: PersistedSessionDb = match serde_json::from_slice(&raw) {
        Ok(db) => db,
        Err(e) => {
            // Malformed db: librqbit itself fails loud constructing the
            // session; not this guard's call to delete anything.
            tracing::warn!("fastresume-guard: {db_path:?} unparseable ({e}); leaving it to librqbit");
            return;
        }
    };
    for entry in db.torrents.values() {
        // The infohash names files we join onto session_dir; only the exact
        // 40-char lowercase-hex shape librqbit writes is trusted.
        let ih = entry.info_hash.as_str();
        if ih.len() != 40 || !ih.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
            tracing::warn!("fastresume-guard: skipping malformed info_hash {ih:?} in {db_path:?}");
            continue;
        }
        match check_fastresume_stale(session_dir, entry) {
            Ok(Some(reason)) => {
                let bitv = bitv_path(session_dir, ih);
                match std::fs::remove_file(&bitv) {
                    Ok(()) => tracing::warn!(
                        "fastresume-guard: invalidated fastresume for {ih} ({reason}); \
                         output_folder={:?}; deleted {bitv:?} so librqbit re-checks instead of \
                         trusting stale state and serving zeros",
                        entry.output_folder,
                    ),
                    Err(e) => tracing::warn!(
                        "fastresume-guard: {ih} is stale ({reason}) but deleting {bitv:?} \
                         failed: {e}; librqbit may resume corrupt state"
                    ),
                }
            }
            Ok(None) => {}
            Err(e) => tracing::warn!(
                "fastresume-guard: cannot verify {ih}: {e:#}; keeping its fastresume as-is"
            ),
        }
    }
}

impl Engine {
    /// Bootstrap the session rooted at `cache_dir`. librqbit lays out per-torrent
    /// subfolders beneath it.
    ///
    /// All torrent storage goes through [`ConfinedStorageFactory`]: every file is
    /// confined under `cache_dir` (path-traversal guard) and created
    /// non-executable. There is no per-torrent size cap - a streaming server
    /// plays a window of a torrent regardless of its total size.
    pub async fn new(cache_dir: PathBuf) -> anyhow::Result<Self> {
        let cache_root = storage::absolutize(&cache_dir)?;

        // Bring-your-own SOCKS5 proxy (privacy): peers see the proxy's IP, not
        // yours. Off unless RILLIO_SOCKS_PROXY is set. NOTE: we never ship a
        // curated proxy list - a stranger's free proxy sees your IP + all traffic
        // and often can't carry UDP (breaks DHT/uTP). Trust is the user's to bring.
        let socks_proxy = std::env::var("RILLIO_SOCKS_PROXY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        // Inbound listen port + UPnP make us reachable by NAT'd/passive seeders -
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
        // real-interface listener would leak the real IP past it - the proxy keeps
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
            // The download cap defaults to the ultra-fast profile's HARD limit
            // (~75 MiB/s, effectively uncapped for any home link), so a fresh
            // install downloads aggressively. A user switching torrent profiles
            // re-applies this live (see `apply_bt_profile`). The explicit env
            // knob still wins at startup for a hard operator override.
            ratelimits: librqbit::limits::LimitsConfig {
                upload_bps: rate_limit_from_env("RILLIO_UPLOAD_LIMIT_KBPS"),
                download_bps: rate_limit_from_env("RILLIO_DOWNLOAD_LIMIT_KBPS")
                    .or_else(|| download_bps_from(BtProfile::ULTRA_FAST.download_speed_hard_limit)),
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
        // Stale fastresume must be invalidated BEFORE the session is built:
        // librqbit trusts the persisted bitfields at restore time, and a
        // "have all" bitfield over missing files silently becomes zero-filled
        // preallocations served as a 100%-complete stream.
        invalidate_stale_fastresume(&cache_dir.join("session"));
        let session = Session::new_with_opts(cache_dir, opts).await?;
        let pinned = read_pins(&cache_root);
        Ok(Self {
            session,
            cache_root: Arc::new(cache_root),
            last_access: Arc::new(Mutex::new(HashMap::new())),
            prefetched: Arc::new(Mutex::new(HashSet::new())),
            bt: Arc::new(Mutex::new(BtProfile::ULTRA_FAST)),
            pinned: Arc::new(Mutex::new(pinned)),
        })
    }

    /// Whether the user pinned this torrent ("download to cache").
    pub fn is_pinned(&self, info_hash: &str) -> bool {
        self.pinned
            .lock()
            .map(|p| p.contains(info_hash))
            .unwrap_or(false)
    }

    /// Pin or unpin a torrent; persists immediately.
    pub fn set_pinned(&self, info_hash: &str, pinned: bool) {
        if let Ok(mut p) = self.pinned.lock() {
            let changed = if pinned {
                p.insert(info_hash.to_owned())
            } else {
                p.remove(info_hash)
            };
            if changed {
                write_pins(&self.cache_root, &p);
            }
        }
    }

    /// Pause a live torrent (the Cached page's per-row pause button).
    pub async fn pause(&self, handle: &Handle) {
        if !handle.is_paused() {
            if let Err(e) = self.session.pause(handle).await {
                tracing::warn!("pause failed: {e:#}");
            }
        }
    }

    /// Resume a paused torrent (a disk-full write error pauses it; the user
    /// fixing the disk and retrying expects it to pick back up).
    pub async fn unpause(&self, handle: &Handle) {
        if handle.is_paused() {
            if let Err(e) = self.session.unpause(handle).await {
                tracing::warn!("unpause failed: {e:#}");
            }
        }
    }

    /// Make sure `file_idx` is part of the torrent's download selection.
    /// `only_files() == None` means every file is selected already.
    pub async fn select_file(&self, handle: &Handle, file_idx: usize) {
        if let Some(only) = handle.only_files() {
            if !only.contains(&file_idx) {
                let mut set: Vec<usize> = only;
                set.push(file_idx);
                if let Err(e) = self.session.update_only_files(handle, &set.into_iter().collect()).await {
                    tracing::warn!("select_file({file_idx}) failed: {e:#}");
                }
            }
        }
    }

    /// The current BitTorrent profile (for `GET /settings` and the stats echo).
    pub fn bt_profile(&self) -> BtProfile {
        self.bt.lock().map(|g| *g).unwrap_or(BtProfile::ULTRA_FAST)
    }

    /// Apply a BitTorrent profile from `POST /settings`. The download-speed HARD
    /// limit takes effect LIVE on the whole session (all torrents, via
    /// librqbit's `Session::ratelimits`). Every other field is stored for
    /// reporting only - librqbit 8.1.1 exposes no knob for them (see
    /// [`BtProfile`]), so we do NOT pretend otherwise.
    pub fn apply_bt_profile(&self, profile: BtProfile) {
        if let Ok(mut g) = self.bt.lock() {
            *g = profile;
        }
        self.session
            .ratelimits
            .set_download_bps(download_bps_from(profile.download_speed_hard_limit));
        tracing::info!(
            "bt-profile applied: download cap ~{} B/s live (max_connections={} reported \
             but librqbit caps live peers at 128; soft/min-peers/timeouts report-only)",
            profile.download_speed_hard_limit,
            profile.max_connections,
        );
    }

    /// Claim the tail prefetch for `(info_hash, file_id)`. Returns `true` only
    /// the FIRST time a pair is seen, so the caller spawns the Cues-warming task
    /// at most once per file. A poisoned lock yields `false` (skip - the
    /// prefetch is best-effort, never load-bearing).
    pub fn mark_prefetch(&self, info_hash: &str, file_id: usize) -> bool {
        mark_prefetch_in(&self.prefetched, info_hash, file_id)
    }

    /// Record that `info_hash` (lowercase hex) was just streamed/queried. Called
    /// from the stream, stats and create routes so the cache sweeper can tell an
    /// actively-used torrent from a stale one.
    pub fn touch(&self, info_hash: &str) {
        if let Ok(mut m) = self.last_access.lock() {
            m.insert(info_hash.to_owned(), Instant::now());
        }
    }

    /// Approximate on-disk cache weight: bytes downloaded (and thus written to the
    /// cache root) across all managed torrents.
    pub fn cache_bytes(&self) -> u64 {
        self.session
            .with_torrents(|it| it.map(|(_, h)| h.stats().progress_bytes).sum())
    }

    /// Enforce a `cap`-byte cache by evicting least-recently-used torrents (which
    /// deletes their cached files) until under the cap. A torrent touched within
    /// `grace` is never evicted, so the currently-playing title is safe. Loud: logs
    /// every eviction and warns if it cannot reach the cap (only active torrents
    /// remain). Adds are never refused by size - the bound is applied here.
    pub async fn enforce_cache_cap(&self, cap: u64, grace: Duration) {
        let mut used = self.cache_bytes();
        if used <= cap {
            return;
        }

        let now = Instant::now();
        let last = self.last_access.lock().map(|m| m.clone()).unwrap_or_default();
        // (infohash, bytes, idle-duration). Unknown touch => most idle (evict first).
        let mut candidates: Vec<(String, u64, Duration)> = self
            .all()
            .iter()
            .map(|h| {
                let ih = Self::info_hash_hex(h);
                let bytes = h.stats().progress_bytes;
                let idle = last.get(&ih).map(|t| now.duration_since(*t)).unwrap_or(Duration::MAX);
                (ih, bytes, idle)
            })
            // Protect anything touched within the grace window (active playback)
            // and anything the user pinned ("download to cache" keeps).
            .filter(|(ih, _, idle)| *idle >= grace && !self.is_pinned(ih))
            .collect();
        // Most idle first.
        candidates.sort_by(|a, b| b.2.cmp(&a.2));

        tracing::warn!("cache-cap: usage ~{used} over cap {cap}; evicting idle torrents");
        for (ih, bytes, _) in candidates {
            if used <= cap {
                break;
            }
            if self.remove(&ih).await {
                if let Ok(mut m) = self.last_access.lock() {
                    m.remove(&ih);
                }
                used = used.saturating_sub(bytes);
                tracing::warn!("cache-cap: evicted {ih} (~{bytes} bytes), usage now ~{used}/{cap}");
            }
        }
        if used > cap {
            tracing::warn!(
                "cache-cap: still ~{used} bytes over {cap} after evicting idle torrents \
                 (active torrents are protected)"
            );
        }
    }

    /// Refuse a torrent whose files would resolve outside the cache root. A
    /// belt-and-suspenders assertion over librqbit-core's own parse-time
    /// rejection. If metadata has not resolved we cannot enumerate the files, so
    /// we fail loud (deny) rather than let the check pass vacuously on an empty
    /// list; callers only run this once metadata is expected to be present.
    fn assert_confined(&self, handle: &Handle) -> anyhow::Result<()> {
        let files: Vec<PathBuf> = handle
            .with_metadata(|m| m.file_infos.iter().map(|fi| fi.relative_filename.clone()).collect())
            .context("assert_confined: torrent metadata not resolved, cannot verify confinement")?;
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

    /// Lowercase hex infohash of a handle. Uses librqbit-core's stable
    /// `Id20::as_string` (`hex::encode` of the raw 20 bytes), NOT Debug
    /// formatting, since every `Engine::get`/`remove`/stats lookup keys off this.
    pub fn info_hash_hex(handle: &Handle) -> String {
        handle.info_hash().as_string()
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
    // exist in its output folder - the second add fails during init with
    // "setting length for file ...: file is None". Since remove→re-add is a real
    // flow, we delete files: a clean teardown that re-adds cleanly, and the
    // natural meaning of "remove" (free the cache) for a streaming server.
    const DELETE_FILES_ON_REMOVE: bool = true;

    /// Stop and forget a torrent by infohash (`GET /:ih/remove`). No-op if not
    /// managed. Returns whether one was found - the route responds `200 {}`
    /// either way (blob parity).
    pub async fn remove(&self, info_hash: &str) -> bool {
        let target = self.session.with_torrents(|it| {
            it.filter(|(_, h)| Self::info_hash_hex(h) == info_hash)
                .map(|(id, _)| id)
                .next()
        });
        if let Some(id) = target {
            let _ = self.session.delete(id.into(), Self::DELETE_FILES_ON_REMOVE).await;
            // A deleted torrent must not leave a stale pin behind (it would
            // shield a future re-add of the same infohash from eviction).
            self.set_pinned(info_hash, false);
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
        // Echo the live torrent profile so the stats menu reflects the selected
        // profile (the download cap is real; the rest is report-only).
        let bt = self.bt_profile();
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
                connections: Some(bt.max_connections),
                dht: false,
                growler: types::Growler {
                    flood: 0,
                    pulse: Some(bt.download_speed_hard_limit as u64),
                },
                handshake_timeout: Some(bt.handshake_timeout),
                path: cache_path,
                peer_search,
                swarm_cap: types::SwarmCap {
                    max_speed: Some(bt.download_speed_soft_limit),
                    min_peers: Some(bt.min_peers_for_stable),
                },
                timeout: Some(bt.request_timeout),
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
            // "initializing" | "live" | "paused" | "error" (librqbit state),
            // plus the failure text (e.g. a disk-full write error) so the
            // player can explain a dead stream to the user.
            engine_state: format!("{:?}", stats.state).to_lowercase(),
            engine_error: stats.error.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Mutex;

    use super::{mark_prefetch_in, read_listen_pref, write_listen_pref, TORRENT_PREFS_FILE};

    #[test]
    fn mark_prefetch_dedups_per_infohash_and_file() {
        let set = Mutex::new(HashSet::new());
        // First claim of a pair wins.
        assert!(mark_prefetch_in(&set, "abc", 0));
        // Repeat of the same pair is refused.
        assert!(!mark_prefetch_in(&set, "abc", 0));
        // A different file in the same torrent is a distinct claim.
        assert!(mark_prefetch_in(&set, "abc", 1));
        assert!(!mark_prefetch_in(&set, "abc", 1));
        // A different torrent, same file index, is also distinct.
        assert!(mark_prefetch_in(&set, "def", 0));
        assert!(!mark_prefetch_in(&set, "def", 0));
    }

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

    // -----------------------------------------------------------------------
    // Stale-fastresume guard
    // -----------------------------------------------------------------------

    use super::{bitv_claims_all_pieces, invalidate_stale_fastresume};

    const IH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /// Minimal valid single-file torrent metainfo (16 KiB pieces). Bencode
    /// dict keys are already in the required sorted order.
    fn single_file_torrent(name: &str, length: u64, num_pieces: usize) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"d4:infod6:lengthi");
        out.extend_from_slice(length.to_string().as_bytes());
        out.extend_from_slice(b"e4:name");
        out.extend_from_slice(format!("{}:{name}", name.len()).as_bytes());
        out.extend_from_slice(b"12:piece lengthi16384e6:pieces");
        out.extend_from_slice(format!("{}:", num_pieces * 20).as_bytes());
        out.extend(std::iter::repeat(0x11u8).take(num_pieces * 20));
        out.extend_from_slice(b"ee");
        out
    }

    /// Minimal valid two-file torrent metainfo (`a.bin` + `b.bin`, 16 KiB each).
    fn two_file_torrent() -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(
            b"d4:infod5:filesl\
              d6:lengthi16384e4:pathl5:a.binee\
              d6:lengthi16384e4:pathl5:b.binee\
              e4:name3:dir12:piece lengthi16384e6:pieces40:",
        );
        out.extend(std::iter::repeat(0x11u8).take(40));
        out.extend_from_slice(b"ee");
        out
    }

    /// Fabricate a librqbit session dir: session.json + .torrent + .bitv.
    /// Returns (session_dir, output_folder, bitv_path).
    fn fake_session(
        tag: &str,
        torrent_bytes: &[u8],
        bitv: &[u8],
    ) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root = fresh_dir(&format!("fastresume-{tag}"));
        let session_dir = root.join("session");
        let out_dir = root.join("out");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        let db = serde_json::json!({
            "torrents": {
                "0": {
                    "info_hash": IH,
                    "trackers": [],
                    "output_folder": out_dir,
                    "only_files": null,
                    "is_paused": false,
                }
            }
        });
        std::fs::write(session_dir.join("session.json"), serde_json::to_vec(&db).unwrap())
            .unwrap();
        std::fs::write(session_dir.join(format!("{IH}.torrent")), torrent_bytes).unwrap();
        let bitv_path = session_dir.join(format!("{IH}.bitv"));
        std::fs::write(&bitv_path, bitv).unwrap();
        (session_dir, out_dir, bitv_path)
    }

    #[test]
    fn stale_bitv_over_fully_missing_files_is_invalidated() {
        // 3 pieces claimed complete (Msb0: top 3 bits), but no data file at all.
        let (session_dir, _out, bitv) =
            fake_session("missing", &single_file_torrent("file.bin", 40960, 3), &[0xE0]);
        invalidate_stale_fastresume(&session_dir);
        assert!(!bitv.exists(), "stale .bitv must be deleted");
        // Metadata and the session db survive so the torrent re-adds cleanly.
        assert!(session_dir.join(format!("{IH}.torrent")).exists());
        assert!(session_dir.join("session.json").exists());
    }

    #[test]
    fn bitv_over_real_data_is_kept() {
        let (session_dir, out, bitv) =
            fake_session("real", &single_file_torrent("file.bin", 40960, 3), &[0xE0]);
        std::fs::write(out.join("file.bin"), vec![0x42u8; 40960]).unwrap();
        invalidate_stale_fastresume(&session_dir);
        assert!(bitv.exists(), "fastresume over real data must survive");
    }

    #[test]
    fn complete_bitv_over_zero_filled_files_is_invalidated() {
        // The already-corrupted variant: librqbit preallocated zeros on a
        // previous run and the bitfield still claims 100%.
        let (session_dir, out, bitv) =
            fake_session("zeros", &single_file_torrent("file.bin", 40960, 3), &[0xE0]);
        std::fs::write(out.join("file.bin"), vec![0u8; 40960]).unwrap();
        invalidate_stale_fastresume(&session_dir);
        assert!(!bitv.exists(), "complete-but-all-zero fastresume must be deleted");
        // The data files are never touched, only the bitfield.
        assert!(out.join("file.bin").exists());
    }

    #[test]
    fn partial_bitv_over_zero_filled_file_is_kept() {
        // Claims only piece 0 of 3: a legit in-progress download whose data
        // happens to be zeros must NOT be nuked (the zero check requires a
        // complete bitfield).
        let (session_dir, out, bitv) =
            fake_session("partial", &single_file_torrent("file.bin", 40960, 3), &[0x80]);
        std::fs::write(out.join("file.bin"), vec![0u8; 40960]).unwrap();
        invalidate_stale_fastresume(&session_dir);
        assert!(bitv.exists());
    }

    #[test]
    fn empty_bitv_is_left_alone() {
        // All-zero bitfield claims nothing; missing files prove nothing.
        let (session_dir, _out, bitv) =
            fake_session("empty", &single_file_torrent("file.bin", 40960, 3), &[0x00]);
        invalidate_stale_fastresume(&session_dir);
        assert!(bitv.exists());
    }

    #[test]
    fn unverifiable_torrent_keeps_fastresume() {
        // Without the .torrent we cannot enumerate expected files: keep.
        let (session_dir, _out, bitv) =
            fake_session("noverify", &single_file_torrent("file.bin", 40960, 3), &[0xFF]);
        std::fs::remove_file(session_dir.join(format!("{IH}.torrent"))).unwrap();
        invalidate_stale_fastresume(&session_dir);
        assert!(bitv.exists());
    }

    #[test]
    fn partially_present_multi_file_torrent_is_kept() {
        // One of two files still exists: a partially-moved tree, not a fully
        // absent download. Conservative rule: keep.
        let (session_dir, out, bitv) = fake_session("multi", &two_file_torrent(), &[0x80]);
        std::fs::write(out.join("a.bin"), vec![0x42u8; 16384]).unwrap();
        invalidate_stale_fastresume(&session_dir);
        assert!(bitv.exists());
    }

    #[test]
    fn fully_missing_multi_file_torrent_is_invalidated() {
        let (session_dir, _out, bitv) = fake_session("multi-gone", &two_file_torrent(), &[0x80]);
        invalidate_stale_fastresume(&session_dir);
        assert!(!bitv.exists());
    }

    #[test]
    fn missing_session_json_is_a_noop() {
        let dir = fresh_dir("fastresume-fresh");
        // Must not panic or create anything on a fresh boot.
        invalidate_stale_fastresume(&dir.join("session"));
    }

    #[test]
    fn bitv_claims_all_pieces_handles_partial_last_byte() {
        // 3 pieces in one byte: top 3 bits (Msb0).
        assert!(bitv_claims_all_pieces(&[0xE0], 3));
        // Pad bits beyond the piece count are ignored.
        assert!(bitv_claims_all_pieces(&[0xFF], 3));
        // Missing piece 2.
        assert!(!bitv_claims_all_pieces(&[0xC0], 3));
        // Exact multiple of 8.
        assert!(bitv_claims_all_pieces(&[0xFF], 8));
        assert!(!bitv_claims_all_pieces(&[0xFE], 8));
        // 9 pieces need two bytes.
        assert!(bitv_claims_all_pieces(&[0xFF, 0x80], 9));
        assert!(!bitv_claims_all_pieces(&[0xFF], 9));
        // Degenerate inputs claim nothing.
        assert!(!bitv_claims_all_pieces(&[], 1));
        assert!(!bitv_claims_all_pieces(&[0xFF], 0));
    }
}

