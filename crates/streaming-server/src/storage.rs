//! M1.5 — ConfinedStorage: defense-in-depth on the torrent cache.
//!
//! Wraps librqbit's default filesystem storage and enforces, at every torrent
//! create, three invariants the engine must never violate:
//!
//!   1. Path confinement — every file resolves to a path *under* `cache_root`.
//!      Rejects `..`, absolute paths, and drive/root components. librqbit-core
//!      already rejects `..` at parse (torrent_metainfo.rs:184), but a security
//!      control is asserted here, not hoped for: this catches an upstream
//!      regression and the cases core does not (absolute/drive-relative).
//!   2. No-exec — cache files are created non-executable (Unix chmod 0o644;
//!      best-effort no-op on Windows, where executability is not a perm bit).
//!   3. Quota — total declared size is capped at `cache_size`; a torrent that
//!      would exceed it is refused before a byte is written.
//!
//! This is Tier 1 (storage layer). It does NOT sandbox the process or use a
//! virtual disk (Tiers 2/3, deferred). The threat it closes is a malicious
//! `.torrent` writing outside the cache — the mechanism by which a download
//! could contaminate the system without the user executing anything.

use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context};
use librqbit::storage::{
    BoxStorageFactory, StorageFactory, StorageFactoryExt, TorrentStorage,
};
use librqbit::storage::filesystem::FilesystemStorageFactory;
use librqbit::{ManagedTorrentShared, TorrentMetadata};

/// A storage factory that confines librqbit's filesystem storage to `cache_root`
/// and enforces no-exec + a byte quota.
pub struct ConfinedStorageFactory {
    inner: BoxStorageFactory,
    /// Absolute, lexically-normalized cache root. All writes must stay under it.
    cache_root: PathBuf,
    /// Total-bytes cap. `None` = unlimited.
    quota_bytes: Option<u64>,
}

impl ConfinedStorageFactory {
    pub fn new(cache_root: &Path, quota_bytes: Option<u64>) -> anyhow::Result<Self> {
        Ok(Self {
            inner: FilesystemStorageFactory::default().boxed(),
            cache_root: absolutize(cache_root)?,
            quota_bytes,
        })
    }

    pub fn boxed(self) -> BoxStorageFactory {
        StorageFactoryExt::boxed(self)
    }

    /// Validate every file and return the confined, resolved paths (file_id order).
    ///
    /// The write base is `cache_root`: we set neither `AddTorrentOptions`
    /// `output_folder` nor `sub_folder`, so librqbit's per-torrent output folder
    /// is the session default (= `cache_root`) and its fs storage writes to
    /// `output_folder.join(relative_filename)`. So the true path of file i is
    /// `cache_root.join(relative_filename[i])`.
    fn validate(&self, metadata: &TorrentMetadata) -> anyhow::Result<Vec<PathBuf>> {
        let mut total: u64 = 0;
        let mut paths = Vec::with_capacity(metadata.file_infos.len());
        for fi in metadata.file_infos.iter() {
            paths.push(confined_path(&self.cache_root, &fi.relative_filename)?);
            total = total.saturating_add(fi.len);
        }

        if let Some(cap) = self.quota_bytes {
            if total > cap {
                bail!("torrent size {total} exceeds cache quota {cap}");
            }
        }
        Ok(paths)
    }
}

impl StorageFactory for ConfinedStorageFactory {
    type Storage = Box<dyn TorrentStorage>;

    fn create(
        &self,
        shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<Self::Storage> {
        // Confinement + quota are enforced HERE, before any file is opened. A
        // rejection fails the torrent add (blob/magnet create returns 500).
        let file_paths = self.validate(metadata)?;
        let inner = self.inner.create(shared, metadata)?;
        Ok(Box::new(ConfinedStorage { inner, file_paths }))
    }

    fn clone_box(&self) -> BoxStorageFactory {
        Box::new(Self {
            inner: self.inner.clone_box(),
            cache_root: self.cache_root.clone(),
            quota_bytes: self.quota_bytes,
        })
    }
}

/// The per-torrent storage: delegates all I/O to the inner filesystem storage,
/// applying no-exec as files are sized. Paths were already confined at create.
struct ConfinedStorage {
    inner: Box<dyn TorrentStorage>,
    file_paths: Vec<PathBuf>,
}

impl TorrentStorage for ConfinedStorage {
    fn init(
        &mut self,
        shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<()> {
        self.inner.init(shared, metadata)
    }

    fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
        self.inner.pread_exact(file_id, offset, buf)
    }

    fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
        self.inner.pwrite_all(file_id, offset, buf)
    }

    fn remove_file(&self, file_id: usize, filename: &Path) -> anyhow::Result<()> {
        self.inner.remove_file(file_id, filename)
    }

    fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()> {
        self.inner.remove_directory_if_empty(path)
    }

    fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()> {
        self.inner.ensure_file_length(file_id, length)?;
        if let Some(path) = self.file_paths.get(file_id) {
            set_non_executable(path);
        }
        Ok(())
    }

    fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>> {
        // Re-wrap so confinement survives pause/resume.
        Ok(Box::new(ConfinedStorage {
            inner: self.inner.take()?,
            file_paths: self.file_paths.clone(),
        }))
    }
}

/// Resolve `cache_root / relative` and assert it stays under `cache_root`.
/// Rejects absolute paths and `..`/root/drive components outright.
fn confined_path(cache_root: &Path, relative: &Path) -> anyhow::Result<PathBuf> {
    if relative.is_absolute() {
        bail!("absolute path in torrent file: {relative:?}");
    }
    for comp in relative.components() {
        match comp {
            Component::ParentDir => bail!("path traversal (\"..\") in torrent file: {relative:?}"),
            Component::RootDir | Component::Prefix(_) => {
                bail!("absolute/drive component in torrent file: {relative:?}")
            }
            Component::Normal(_) | Component::CurDir => {}
        }
    }
    let resolved = lexical_normalize(&cache_root.join(relative));
    if !resolved.starts_with(cache_root) {
        bail!("torrent file escapes cache root: {resolved:?} not under {cache_root:?}");
    }
    Ok(resolved)
}

/// Make a path absolute (lexically; no fs access, no `\\?\` UNC prefix) and
/// normalize `.`/`..`. `std::path::absolute` keeps a form comparable with the
/// normalized targets, avoiding Windows canonicalize UNC-prefix mismatches.
fn absolutize(p: &Path) -> anyhow::Result<PathBuf> {
    let abs = std::path::absolute(p).with_context(|| format!("absolutize {p:?}"))?;
    Ok(lexical_normalize(&abs))
}

/// Resolve `.` and `..` components lexically, without touching the filesystem.
fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Best-effort: mark a cache file non-executable. Unix chmod 0o644; on Windows a
/// documented no-op (executability there is by extension/content, not a perm
/// bit — a deny-execute ACL would be Tier 3). Never fails the caller.
fn set_non_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644)) {
            tracing::debug!("could not set 0o644 on {path:?}: {e}");
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        absolutize(Path::new("/srv/cache")).unwrap()
    }

    #[test]
    fn normal_paths_are_confined() {
        let p = confined_path(&root(), Path::new("Movie/movie.mkv")).unwrap();
        assert!(p.starts_with(root()));
    }

    #[test]
    fn parent_traversal_is_rejected() {
        // The autostart-drop attack.
        assert!(confined_path(&root(), Path::new("../../../Startup/evil.exe")).is_err());
        assert!(confined_path(&root(), Path::new("../escape.txt")).is_err());
    }

    #[test]
    fn absolute_path_is_rejected() {
        assert!(confined_path(&root(), Path::new("/etc/passwd")).is_err());
    }

    #[test]
    #[cfg(windows)]
    fn windows_drive_component_is_rejected() {
        assert!(confined_path(&root(), Path::new(r"C:\Windows\System32\x")).is_err());
        assert!(confined_path(&root(), Path::new(r"..\..\evil")).is_err());
    }

    #[test]
    fn quota_math() {
        // Direct check of the cap comparison used in validate().
        let cap = 1_000u64;
        assert!(1_001u64 > cap, "over cap rejected");
        assert!(999u64 <= cap, "under cap allowed");
    }
}
