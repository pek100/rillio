# Fetch libmpv-2.dll and inject it into the Tauri bundle resources (Windows CI).
#
# Playback needs libmpv-2.dll next to the exe (loaded at runtime via libloading;
# see mpv.rs default_dll_path). It is gitignored, so CI stages an official shared
# build here rather than committing the DLL or the config change - that way a
# normal local `cargo build` (no DLL on disk) still works.
#
# NOTE: these builds are GPL; shipping the DLL carries the usual GPL source
# obligations.
#
# Bumping mpv: update the three pinned values together. The sha256 is the asset's
# `digest` field on
# api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/<tag>.
#
# Requires GITHUB_TOKEN in the environment (the API call is rate-limited without
# one). Used by .github/workflows/ci.yml and release.yml.

$ErrorActionPreference = 'Stop'

$releaseTag = '20260610'
$assetName = 'mpv-dev-x86_64-20260610-git-304426c.7z'
$sha256 = '8cbb25ea784f01afbb3f904217cab1317430a8bcfd5680fd827a866367f71cc9'

$repoRoot = Split-Path $PSScriptRoot -Parent
$tauriDir = Join-Path $repoRoot 'apps/desktop/src-tauri'

$rel = Invoke-RestMethod "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/$releaseTag" -Headers @{ Authorization = "Bearer $env:GITHUB_TOKEN"; 'User-Agent' = 'rillio-ci' }
$asset = $rel.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) { throw "asset $assetName not found in shinchiro release $releaseTag" }

Write-Host "downloading $($asset.name)"
$archive = Join-Path $repoRoot 'mpv-dev.7z'
Invoke-WebRequest $asset.browser_download_url -OutFile $archive
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $sha256) {
    throw "SHA256 mismatch for ${assetName}: expected $sha256, got $actual"
}

7z e $archive libmpv-2.dll -o"$tauriDir" -y
$dll = Join-Path $tauriDir 'libmpv-2.dll'
if (-not (Test-Path $dll)) { throw 'libmpv-2.dll not extracted' }

# Inject as a bundle resource. Written with UTF8Encoding($false): PowerShell 5.1's
# Set-Content -Encoding utf8 writes a BOM, and a BOM in tauri.conf.json / Cargo.toml
# has already killed one release (tauri-action chokes on U+FEFF).
$cfgPath = Join-Path $tauriDir 'tauri.conf.json'
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg.bundle | Add-Member -NotePropertyName resources -NotePropertyValue @('libmpv-2.dll') -Force
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 30), (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'injected libmpv-2.dll into bundle.resources'
