// Multi-profile localStorage: every piece of per-user data (the core's buckets,
// the display name, web-side prefs) is read and written through here so it lands
// in the ACTIVE profile's namespace.
//
// Layout:
//   rillio.profiles.registry   (meta, never prefixed) - { v: 1, profiles: [{ id, createdAt }] }
//   rillio.profiles.active     (meta, never prefixed) - the active profile id
//   <key>                      - the DEFAULT profile's data, raw legacy keys.
//     The pre-multi-profile install simply IS the default profile; zero
//     migration, an update can never touch existing data (0.1.17 lesson).
//   p:<id>:<key>               - any other profile's data.
//
// The wasm core reads its buckets through the same namespace: the worker's
// storage RPC targets window.rillioStorage (core/coreStorageBridge), which binds
// to getItem/setItem/removeItem here. Switching profiles writes the active
// pointer and RELOADS - the core boots fresh from the new namespace, so no
// stale in-memory state can cross profiles.

const REGISTRY_KEY = 'rillio.profiles.registry';
const ACTIVE_KEY = 'rillio.profiles.active';
export const DEFAULT_PROFILE_ID = 'default';

export type ProfileEntry = {
    id: string;
    createdAt: number;
};

type Registry = { v: 1, profiles: ProfileEntry[] };

const readRegistry = (): Registry => {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (raw !== null) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.v === 1 && Array.isArray(parsed.profiles) &&
                parsed.profiles.some((p: ProfileEntry) => p && p.id === DEFAULT_PROFILE_ID)) {
                return parsed as Registry;
            }
        } catch { /* fall through to reseed */ }
    }
    // First run (or an unreadable registry): seed with the default profile. The
    // default's DATA is the raw keys, so reseeding the registry loses nothing.
    const seeded: Registry = { v: 1, profiles: [{ id: DEFAULT_PROFILE_ID, createdAt: Date.now() }] };
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(seeded));
    return seeded;
};

// The active id is fixed for the lifetime of the page: switching always
// reloads, so caching at module load keeps every read consistent (a pointer
// write mid-session must never split the core's buckets across namespaces).
const readActiveId = (): string => {
    const id = window.localStorage.getItem(ACTIVE_KEY);
    if (id === null) return DEFAULT_PROFILE_ID;
    return readRegistry().profiles.some((p) => p.id === id) ? id : DEFAULT_PROFILE_ID;
};
const ACTIVE_ID = readActiveId();

const prefixFor = (profileId: string): string =>
    profileId === DEFAULT_PROFILE_ID ? '' : `p:${profileId}:`;

export const activeProfileId = (): string => ACTIVE_ID;

/** The active profile's storage key for `key`. */
export const storageKey = (key: string): string => prefixFor(ACTIVE_ID) + key;

// The three accessors the whole app (and, via coreStorageBridge, the wasm core)
// uses. Deliberately synchronous and unguarded: a storage failure here means
// the profile system itself is broken, and that must surface, not be papered
// over (no silent fallbacks).
export const getItem = (key: string): string | null =>
    window.localStorage.getItem(storageKey(key));
export const setItem = (key: string, value: string): void =>
    window.localStorage.setItem(storageKey(key), value);
export const removeItem = (key: string): void =>
    window.localStorage.removeItem(storageKey(key));

/** Read another profile's value (the picker shows every profile's name). */
export const getItemForProfile = (profileId: string, key: string): string | null =>
    window.localStorage.getItem(prefixFor(profileId) + key);
export const setItemForProfile = (profileId: string, key: string, value: string): void =>
    window.localStorage.setItem(prefixFor(profileId) + key, value);

export const listProfiles = (): ProfileEntry[] => readRegistry().profiles;

export const createProfile = (): ProfileEntry => {
    const registry = readRegistry();
    let id: string;
    do {
        id = Math.random().toString(36).slice(2, 10);
    } while (id === DEFAULT_PROFILE_ID || registry.profiles.some((p) => p.id === id));
    const entry: ProfileEntry = { id, createdAt: Date.now() };
    registry.profiles.push(entry);
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    return entry;
};

/** Point the app at another profile. The caller MUST reload the page. */
export const switchProfile = (profileId: string): void => {
    if (!readRegistry().profiles.some((p) => p.id === profileId)) {
        throw new Error(`Unknown profile "${profileId}".`);
    }
    window.localStorage.setItem(ACTIVE_KEY, profileId);
};

/**
 * Delete a profile and all of its data. The active profile and the default
 * profile are protected: the default's data lives in raw unprefixed keys
 * (indistinguishable from non-profile keys, so a scan cannot safely remove
 * them), and deleting the profile under the running app would corrupt it.
 */
export const deleteProfile = (profileId: string): void => {
    if (profileId === DEFAULT_PROFILE_ID) throw new Error('The original profile cannot be deleted.');
    if (profileId === ACTIVE_ID) throw new Error('Switch away from a profile before deleting it.');
    const registry = readRegistry();
    if (!registry.profiles.some((p) => p.id === profileId)) return;
    const prefix = prefixFor(profileId);
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k !== null && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
    registry.profiles = registry.profiles.filter((p) => p.id !== profileId);
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
};
