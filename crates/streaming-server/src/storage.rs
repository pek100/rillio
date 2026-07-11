//! M1.5 - cache confinement (path-traversal guard).
//!
//! The threat this closes: a malicious `.torrent` writing files *outside* the
//! cache (e.g. dropping into the Startup folder) - the way a download could
//! contaminate the system without the user executing anything.
//!
//! We no longer wrap librqbit's storage factory. That wrapper blocked
//! librqbit's fast-resume (its JSON persistence store requires the *exact*
//! `FilesystemStorageFactory` type - a wrapper fails its `TypeId` check - so
//! every restart re-hashed the whole file). Instead we keep the check as a
//! pre-add assertion ([`assert_confined`]) and rely on librqbit-core, which
//! already rejects `..` and path separators inside filename components at parse
//! (`torrent_metainfo.rs`: "path traversal detected"). Defense in depth: core
//! blocks it, and we re-assert it before streaming.
//!
//! No-exec (Unix chmod 0o644) went away with the wrapper; it was always a no-op
//! on Windows (executability there is by extension/content, not a perm bit) and
//! is a Unix-only follow-up if we target Unix.

use std::path::{Component, Path, PathBuf};

use anyhow::bail;

/// Assert every `relative` path resolves *under* `cache_root`. Returns an error
/// naming the first offender. Call before streaming a freshly-added torrent.
pub fn assert_confined<'a, I>(cache_root: &Path, relatives: I) -> anyhow::Result<()>
where
    I: IntoIterator<Item = &'a Path>,
{
    let root = absolutize(cache_root)?;
    for relative in relatives {
        confined_path(&root, relative)?;
    }
    Ok(())
}

/// Resolve `cache_root / relative` and assert it stays under `cache_root`.
/// Rejects absolute paths and `..`/root/drive components outright.
pub fn confined_path(cache_root: &Path, relative: &Path) -> anyhow::Result<PathBuf> {
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
pub fn absolutize(p: &Path) -> anyhow::Result<PathBuf> {
    use anyhow::Context;
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
    fn assert_confined_flags_first_offender() {
        let good = Path::new("Movie/a.mkv");
        let bad = Path::new("../evil");
        assert!(assert_confined(Path::new("/srv/cache"), [good]).is_ok());
        assert!(assert_confined(Path::new("/srv/cache"), [good, bad]).is_err());
    }
}
