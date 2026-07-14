// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Polls the shell for a snapshot of the current video frame while a player panel is
 * open, for the menus'/drawer's blurred backdrop (see SnapshotBackdrop for why the
 * frame has to come from the shell at all).
 *
 * Cost is zero when nothing is open: the poll only runs while `open`, and the shell
 * rate-limits real captures on its side too.
 *
 * FAILS QUIET: outside the shell, or once the shell has errored a few times in a row
 * (no video loaded, a libmpv without screenshot support, ...), this returns null
 * forever after and stops polling. Null means the panels render exactly as they do
 * today, dark glass only - never a spinner, never a crash. One console.warn marks it.
 */

import { useEffect, useState } from 'react';
import { useTauriApi } from 'rillio/common/Platform/shell/isShell';

// ~3fps. The backdrop lives under a 24px blur and 55% black, so it only has to be
// "live enough"; the shell's own guard rejects anything faster than 200ms.
const SNAPSHOT_INTERVAL = 330;
// Consecutive failures after which we give up for this open panel. One transient
// error (a frame between loads) must not disable the backdrop for good.
const MAX_ERRORS = 3;

const useVideoSnapshotBackdrop = (open: boolean): string | null => {
    const TAURI = useTauriApi();
    const [snapshot, setSnapshot] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !TAURI?.core?.invoke) {
            setSnapshot(null);
            return undefined;
        }

        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let errors = 0;

        const tick = async () => {
            try {
                const dataUrl = await TAURI.core.invoke('player_snapshot');
                if (cancelled) return;
                if (typeof dataUrl === 'string' && dataUrl.length > 0) {
                    setSnapshot(dataUrl);
                    errors = 0;
                }
            } catch (e) {
                if (cancelled) return;
                errors += 1;
                if (errors === 1) {
                    console.warn('Player', 'video snapshot backdrop unavailable, falling back to plain glass', e);
                }
                if (errors >= MAX_ERRORS) {
                    setSnapshot(null);
                    return; // stop polling; the panels keep their dark glass
                }
            }
            if (!cancelled) {
                timeout = setTimeout(tick, SNAPSHOT_INTERVAL);
            }
        };
        tick();

        return () => {
            cancelled = true;
            if (timeout !== null) clearTimeout(timeout);
            setSnapshot(null);
        };
    }, [open, TAURI]);

    return snapshot;
};

export default useVideoSnapshotBackdrop;
