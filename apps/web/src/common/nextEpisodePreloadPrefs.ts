// Copyright (C) 2017-2026 Smart code 203358507

// Preferences for the next-episode preload prompt. These persist in
// localStorage rather than core profile.settings because the core settings
// schema is fixed in Rust (crates/core) and this is a web-only UX preference.
// localStorage access is wrapped: it can throw (storage disabled/full) and a
// broken preference store must degrade to defaults, loudly, not crash playback.

const ENABLED_KEY = 'rillio.preloadPrompt.enabled';

export const getPreloadPromptEnabled = (): boolean => {
    try {
        return window.localStorage.getItem(ENABLED_KEY) !== 'false';
    } catch (error) {
        console.error('nextEpisodePreloadPrefs: failed to read the enabled flag', error);
        return true;
    }
};

export const setPreloadPromptEnabled = (enabled: boolean): void => {
    try {
        window.localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (error) {
        console.error('nextEpisodePreloadPrefs: failed to persist the enabled flag', error);
    }
};
