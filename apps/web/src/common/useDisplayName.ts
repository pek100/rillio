// A local, anonymous-first display name. Stremio has no username field (only an
// account email), and anonymous users have no identity at all, so Rillio keeps
// its own editable name in storage, no account, no server, no core change.
// A random friendly handle is assigned on first run; the user can rename anytime.
// Per profile (common/profileStorage): each local profile has its own name.
import { useCallback, useEffect, useState } from 'react';
import { getItem, setItem } from 'rillio/common/profileStorage';

const KEY = 'rillio.displayName';
const EVENT = 'rillio:display-name-changed';

const ADJECTIVES = [
    'Swift', 'Quiet', 'Bright', 'Calm', 'Bold', 'Lunar', 'Amber', 'Hidden',
    'Wandering', 'Curious', 'Northern', 'Velvet', 'Gentle', 'Electric', 'Crimson', 'Silver',
];
const NOUNS = [
    'Heron', 'Otter', 'Comet', 'Fox', 'Cedar', 'Falcon', 'Harbor', 'Ember',
    'Willow', 'Rill', 'Meridian', 'Lantern', 'Nomad', 'Cove', 'Sparrow', 'Delta',
];

// Generate a friendly two-word handle (deterministic randomness is fine here; this
// only runs in the browser, never in a headless/replayable context).
export const randomDisplayName = (): string => {
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${a} ${n}`;
};

const read = (): string => {
    try {
        let v = getItem(KEY);
        if (!v || !v.trim()) {
            v = randomDisplayName();
            setItem(KEY, v);
        }
        return v;
    } catch {
        return 'Guest';
    }
};

// Assign a random name on first launch so an anonymous account has an identity
// out of the box (not only once the account menu is opened). Idempotent.
export const ensureDisplayName = (): void => { read(); };

// Persist a new name (empty reverts to a fresh random handle) and notify every
// consumer in this window. Returns the value actually stored.
export const setDisplayName = (name: string): string => {
    const v = (name || '').trim() || randomDisplayName();
    try {
        setItem(KEY, v);
    } catch {
        /* storage unavailable, keep in-memory only */
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
    return v;
};

export const useDisplayName = (): [string, (name: string) => void] => {
    const [name, setName] = useState<string>(read);
    useEffect(() => {
        const onChange = () => setName(read());
        window.addEventListener(EVENT, onChange);
        window.addEventListener('storage', onChange);
        return () => {
            window.removeEventListener(EVENT, onChange);
            window.removeEventListener('storage', onChange);
        };
    }, []);
    const update = useCallback((n: string) => setName(setDisplayName(n)), []);
    return [name, update];
};
