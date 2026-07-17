// Read-only Stremio API client for VERIFYING sync: fetch the server's view of
// the account (library mtimes, addon collection) and diff it against the local
// buckets, so the sync UI can show, concretely, what a sync will move and that
// a finished sync converged. All actual syncing is done by the core
// (Ctx.SyncLibraryWithAPI / PushAddonsToAPI / PullAddonsFromAPI) with the
// live session; this module never writes to the API and never mutates local
// state. Wire format mirrors the core byte for byte
// (crates/core/src/types/api/request.rs, fetch_api.rs).
//
// This replaces the old common/stremioUpload.ts: uploads no longer need a
// temporary session because the app now STAYS connected and the core merges
// instead of replacing on login (see update_profile.rs / update_library.rs
// CtxAuthResult).

import { getItem } from 'rillio/common/profileStorage';

// Same endpoint the core uses (API_URL in crates/core/src/constants.rs).
const API_BASE = 'https://api.strem.io/api/';

// LIBRARY_COLLECTION_NAME in crates/core/src/constants.rs.
const LIBRARY_COLLECTION = 'libraryItem';

// Persisted LibraryItem, as the core stores it (crates/core/src/types/library/
// library_item.rs): the storage serde and the API serde are the same struct.
export type StoredLibraryItem = {
    _id: string;
    name?: string;
    type: string;
    removed: boolean;
    _mtime: string;
    [key: string]: unknown;
};

export type StoredAddon = {
    transportUrl: string;
    manifest?: { name?: string };
    [key: string]: unknown;
};

// POST one API request and unwrap the { result } | { error: { message, code } }
// envelope (crates/core/src/types/api/response.rs). Any failure throws.
export const apiFetch = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    let response: Response;
    try {
        response = await fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error(`Could not reach the Stremio API (${path}). Check your connection and try again.`);
    }
    if (!response.ok) {
        throw new Error(`The Stremio API returned HTTP ${response.status} for ${path}.`);
    }
    let envelope: { result?: T; error?: { message?: string; code?: number } };
    try {
        envelope = await response.json();
    } catch {
        throw new Error(`The Stremio API sent an unreadable response for ${path}.`);
    }
    if (envelope.error) {
        throw new Error(envelope.error.message || `The Stremio API rejected the ${path} request.`);
    }
    if (!('result' in envelope) || envelope.result === undefined || envelope.result === null) {
        throw new Error(`The Stremio API sent an empty response for ${path}.`);
    }
    return envelope.result;
};

const readBucketItems = (key: string): Record<string, StoredLibraryItem> => {
    const raw = getItem(key);
    if (raw === null) return {};
    let bucket: unknown;
    try {
        bucket = JSON.parse(raw);
    } catch {
        throw new Error(`The local "${key}" data is not valid JSON.`);
    }
    if (bucket === null || typeof bucket !== 'object' || typeof (bucket as { items?: unknown }).items !== 'object') {
        throw new Error(`The local "${key}" data does not look like a library bucket.`);
    }
    return ((bucket as { items: Record<string, StoredLibraryItem> | null }).items) || {};
};

// The core splits the library across two buckets (LIBRARY_RECENT_STORAGE_KEY +
// LIBRARY_STORAGE_KEY); merge them, recent bucket winning on overlap.
export const readLocalLibraryItems = (): StoredLibraryItem[] => {
    const items = { ...readBucketItems('library'), ...readBucketItems('library_recent') };
    return Object.values(items);
};

export const readLocalAddons = (): StoredAddon[] => {
    const raw = getItem('profile');
    if (raw === null) return [];
    let profile: unknown;
    try {
        profile = JSON.parse(raw);
    } catch {
        throw new Error('The local profile data is not valid JSON.');
    }
    const addons = profile !== null && typeof profile === 'object' ? (profile as { addons?: unknown }).addons : null;
    if (!Array.isArray(addons)) return [];
    return addons.filter((addon): addon is StoredAddon =>
        addon !== null && typeof addon === 'object' && typeof addon.transportUrl === 'string');
};

// Mirror of LibraryItem::should_sync (crates/core/src/types/library/
// library_item.rs): skip "other" items, and skip removals older than a year.
export const shouldSync = (item: StoredLibraryItem): boolean => {
    const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const mtime = Date.parse(item._mtime);
    if (!Number.isFinite(mtime)) return false;
    const recentlyRemoved = item.removed && mtime > yearAgo;
    return item.type !== 'other' && (!item.removed || recentlyRemoved);
};

export type SyncDiffEntry = {
    id: string;
    name: string | null;
    removed?: boolean;
};

export type SyncAddonEntry = {
    transportUrl: string;
    name: string | null;
};

export type SyncDiff = {
    at: number;
    localItems: number;
    serverItems: number;
    // Library items a sync will SEND (missing on the account, or newer here).
    toPush: SyncDiffEntry[];
    // Library items a sync will FETCH (missing here, or newer on the account).
    toPull: SyncDiffEntry[];
    // Add-ons installed here but not on the account (sent on connect/install).
    addonsLocalOnly: SyncAddonEntry[];
    // Add-ons on the account but not here (arrive with the next add-on pull).
    addonsServerOnly: SyncAddonEntry[];
};

export const diffIsClean = (diff: SyncDiff): boolean =>
    diff.toPush.length === 0 && diff.toPull.length === 0 &&
    diff.addonsLocalOnly.length === 0 && diff.addonsServerOnly.length === 0;

// The before/after view: the server's per-item mtimes (datastoreMeta) and addon
// collection vs the local buckets, compared with the same second-granularity
// rule the core's plan_sync_with_api uses. Read-only; safe to call any time.
export const computeSyncDiff = async (authKey: string): Promise<SyncDiff> => {
    const localItems = readLocalLibraryItems().filter(shouldSync);
    const localAddons = readLocalAddons();

    const [remoteMeta, collection] = await Promise.all([
        apiFetch<[string, number][]>('datastoreMeta', { authKey, collection: LIBRARY_COLLECTION }),
        apiFetch<{ addons: StoredAddon[] | null }>('addonCollectionGet', {
            type: 'AddonCollectionGet',
            authKey,
            update: false,
        }),
    ]);

    const remoteSeconds = new Map<string, number>();
    for (const entry of remoteMeta) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
            remoteSeconds.set(entry[0], Math.floor(entry[1] / 1000));
        }
    }
    const localById = new Map(localItems.map((item) => [item._id, item]));

    const toPush: SyncDiffEntry[] = [];
    for (const item of localItems) {
        const remote = remoteSeconds.get(item._id);
        const localSec = Math.floor(Date.parse(item._mtime) / 1000);
        if (remote === undefined || remote < localSec) {
            toPush.push({ id: item._id, name: item.name ?? null, removed: item.removed === true });
        }
    }
    const toPull: SyncDiffEntry[] = [];
    for (const [id, remoteSec] of remoteSeconds) {
        const local = localById.get(id);
        if (local === undefined || Math.floor(Date.parse(local._mtime) / 1000) < remoteSec) {
            toPull.push({ id, name: local?.name ?? null });
        }
    }

    const remoteAddons = Array.isArray(collection.addons) ? collection.addons : [];
    const addonName = (addon: StoredAddon): string | null => addon.manifest?.name ?? null;
    const remoteUrls = new Set(remoteAddons.map((addon) => addon.transportUrl));
    const localUrls = new Set(localAddons.map((addon) => addon.transportUrl));
    const addonsLocalOnly = localAddons
        .filter((addon) => !remoteUrls.has(addon.transportUrl))
        .map((addon) => ({ transportUrl: addon.transportUrl, name: addonName(addon) }));
    const addonsServerOnly = remoteAddons
        .filter((addon) => !localUrls.has(addon.transportUrl))
        .map((addon) => ({ transportUrl: addon.transportUrl, name: addonName(addon) }));

    return {
        at: Date.now(),
        localItems: localItems.length,
        serverItems: remoteSeconds.size,
        toPush,
        toPull,
        addonsLocalOnly,
        addonsServerOnly,
    };
};
