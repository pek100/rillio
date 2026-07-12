// Copyright (C) 2017-2024 Smart code 203358507

const React = require('react');
const { deepEqual } = require('fast-equals');
const { useCore } = require('rillio/core');

// The web `ctx` model carries a compact, id-keyed `library` map
// ({ [metaId]: { removed, watched } }). Rather than every media card opening its
// own (expensive) model subscription, we keep ONE shared subscription to the
// `ctx` model here and let each card index into a memoized lookup. This mirrors
// how useNotifications/useProfile read the same `ctx` model, but fanned out to
// many cards cheaply.

const MODEL = 'ctx';
const EMPTY_STATE = Object.freeze({ inLibrary: false, watched: false });

const store = {
    core: null,
    initialized: false,
    ready: false,
    // metaId -> frozen { inLibrary, watched }. References are kept stable when an
    // item's state is unchanged so useSyncExternalStore skips re-rendering cards
    // whose own state did not move.
    items: new Map(),
    listeners: new Set(),
    subscribe(listener) {
        store.listeners.add(listener);
        return () => {
            store.listeners.delete(listener);
        };
    },
    emit() {
        store.listeners.forEach((listener) => listener());
    },
    getSnapshot(metaId) {
        if (typeof metaId !== 'string' || metaId.length === 0) {
            return EMPTY_STATE;
        }

        const existing = store.items.get(metaId);
        return existing !== undefined ? existing : EMPTY_STATE;
    },
    apply(library) {
        const source = library !== null && typeof library === 'object' ? library : {};
        const next = new Map();
        let changed = false;
        Object.keys(source).forEach((metaId) => {
            const entry = source[metaId] || {};
            const state = { inLibrary: entry.removed === false, watched: entry.watched === true };
            const prev = store.items.get(metaId);
            if (prev !== undefined && deepEqual(prev, state)) {
                next.set(metaId, prev);
            } else {
                next.set(metaId, Object.freeze(state));
                changed = true;
            }
        });
        if (!changed) {
            // Detect items that dropped out of the library map entirely.
            for (const metaId of store.items.keys()) {
                if (!next.has(metaId)) {
                    changed = true;
                    break;
                }
            }
        }
        if (changed || next.size !== store.items.size) {
            store.items = next;
        }
        if (!store.ready) {
            store.ready = true;
            changed = true;
        }
        if (changed) {
            store.emit();
        }
    },
    ensureInit(core) {
        if (store.initialized) {
            return;
        }

        store.initialized = true;
        store.core = core;
        const onState = async (models) => {
            // The core emits the list of changed models; only refetch when `ctx`
            // (or an unknown/initial signal) is involved.
            if (Array.isArray(models) && models.indexOf(MODEL) === -1) {
                return;
            }

            const ctx = await core.transport.getState(MODEL);
            store.apply(ctx && ctx.library ? ctx.library : null);
        };
        core.on('state', onState);
        onState([MODEL]);
    },
};

// Reads the live library state for a single meta id and returns toggles for
// library membership and watched state. `fallback` (the item's serialized
// { inLibrary, watched }) is used only until the shared store has loaded, to
// avoid a first-paint flash. When `metaId` is absent, state is inert and the
// toggles are no-ops.
const useLibraryItemState = (metaId, fallback) => {
    const core = useCore();
    store.ensureInit(core);

    const hasId = typeof metaId === 'string' && metaId.length > 0;
    const subscribe = React.useCallback((listener) => store.subscribe(listener), []);
    const getSnapshot = React.useCallback(() => store.getSnapshot(metaId), [metaId]);
    const liveState = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const fallbackInLibrary = !!(fallback && fallback.inLibrary);
    const fallbackWatched = !!(fallback && fallback.watched);
    const inLibrary = store.ready ? liveState.inLibrary : fallbackInLibrary;
    const watched = store.ready ? liveState.watched : fallbackWatched;

    const toggleInLibrary = React.useCallback((metaPreview) => {
        if (!hasId) {
            return;
        }

        if (inLibrary) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'RemoveFromLibrary',
                    args: metaId
                }
            });
        } else if (metaPreview && typeof metaPreview === 'object') {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'AddToLibrary',
                    args: metaPreview
                }
            });
        }
    }, [core, metaId, hasId, inLibrary]);

    const toggleWatched = React.useCallback((metaPreview) => {
        if (!hasId || !metaPreview || typeof metaPreview !== 'object') {
            return;
        }

        // MetaItemMarkAsWatched is the Ctx-level action meant for previews: it
        // toggles watched state (creating a temporary LibraryItem if needed)
        // without loading the MetaDetails model for this item. Its Rust struct
        // fields are not camelCased, hence the snake_case keys below.
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'MetaItemMarkAsWatched',
                args: {
                    meta_item: metaPreview,
                    is_watched: !watched
                }
            }
        });
    }, [core, metaId, hasId, watched]);

    return { inLibrary, watched, toggleInLibrary, toggleWatched, hasId };
};

module.exports = useLibraryItemState;
