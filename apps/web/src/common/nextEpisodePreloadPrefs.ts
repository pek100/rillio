// Copyright (C) 2017-2026 Smart code 203358507

// Preferences for the next-episode preload prompt. These persist in storage
// (per profile, via common/profileStorage) rather than core profile.settings
// because the core settings schema is fixed in Rust (crates/core) and this is a
// web-only UX preference. Access is wrapped: it can throw (storage disabled or
// full) and a broken preference store must degrade to defaults, loudly, not
// crash playback.

import { getItem, setItem } from 'rillio/common/profileStorage';

const ENABLED_KEY = 'rillio.preloadPrompt.enabled';

export const getPreloadPromptEnabled = (): boolean => {
    try {
        return getItem(ENABLED_KEY) !== 'false';
    } catch (error) {
        console.error('nextEpisodePreloadPrefs: failed to read the enabled flag', error);
        return true;
    }
};

export const setPreloadPromptEnabled = (enabled: boolean): void => {
    try {
        setItem(ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (error) {
        console.error('nextEpisodePreloadPrefs: failed to persist the enabled flag', error);
    }
};
