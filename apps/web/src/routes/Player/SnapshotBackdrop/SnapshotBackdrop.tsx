// Copyright (C) 2017-2026 Smart code 203358507

/**
 * The real blurred-video backdrop behind a player panel (the five menu layers and
 * the SideDrawer).
 *
 * WHY THIS EXISTS: mpv renders into a NATIVE child window BEHIND the transparent
 * WebView, so a panel's CSS `backdrop-filter` samples only web content and blurs
 * nothing at all. Instead the shell hands us a downscaled JPEG of the current
 * frame (`player_snapshot`, see useVideoSnapshotBackdrop) and we blur it ourselves.
 *
 * THE TECHNIQUE (the standard "fake backdrop-filter"): a clip layer matching the
 * panel's rounded bounds holds an image sized to the FULL VIDEO VIEWPORT, not to
 * the panel. The slice visible through the clip is therefore exactly the region of
 * video behind the panel, so the backdrop tracks what is actually on screen.
 *
 * The image cannot simply be `position: fixed`: the panels carry `backdrop-blur`,
 * and a backdrop-filter (like a transform or filter) makes the element a
 * containing block for fixed descendants, so `fixed` would resolve to the PANEL
 * and pin the image's corner to the panel's corner instead of the viewport's. We
 * therefore measure the clip layer's viewport rect and offset an absolutely
 * positioned image by its negation, which is agnostic to whatever containing block
 * an ancestor happens to establish.
 *
 * LAYERING: the clip layer sits at `-z-10` inside the panel. Per CSS painting
 * order a negative-z child paints AFTER the panel's own background, so the panel's
 * dark glass ends up BEHIND the (opaque) snapshot and cannot darken it. The dark
 * glass over the video is therefore this component's own tint layer, painted on top
 * of the image, using the same `--modal-background-color` token. Net result, back to
 * front: snapshot -> dark glass -> the panel's content, unchanged.
 *
 * FALLBACK: no src (not in the shell, no video, or the shell errored) renders
 * nothing at all, leaving the panel exactly as it looks today - dark glass only.
 * Never a spinner, never a crash.
 */

import React, { createContext, memo, useContext, useLayoutEffect, useRef, useState } from 'react';

// The current snapshot data URL, provided by the Player route. Read through
// context rather than a prop so each panel's edit is a single self-contained
// child and no snapshot plumbing threads through their signatures. React context
// crosses portals, so the (portaled) SideDrawer receives it too.
export const SnapshotBackdropContext = createContext<string | null>(null);

type Offset = { top: number; left: number };

const SnapshotBackdrop = memo(function SnapshotBackdrop() {
    const src = useContext(SnapshotBackdropContext);
    const clipRef = useRef<HTMLDivElement>(null);
    const [offset, setOffset] = useState<Offset | null>(null);

    useLayoutEffect(() => {
        const clip = clipRef.current;
        if (!src || !clip) {
            return undefined;
        }
        const measure = () => {
            const rect = clip.getBoundingClientRect();
            setOffset((current) => {
                // Skip no-op state updates: this runs from a ResizeObserver.
                if (current !== null && current.top === rect.top && current.left === rect.left) {
                    return current;
                }
                return { top: rect.top, left: rect.left };
            });
        };
        measure();
        // The panels are anchored (bottom-right / right edge), so any size change
        // moves their top-left corner: observing size covers both.
        const observer = new ResizeObserver(measure);
        observer.observe(clip);
        window.addEventListener('resize', measure);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [src]);

    if (!src) {
        return null;
    }

    return (
        <div
            ref={clipRef}
            aria-hidden={true}
            className={'pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]'}
        >
            {
                // Rendered once measured, so it never flashes in misaligned.
                offset !== null ?
                    <img
                        src={src}
                        alt={''}
                        // scale-105 pushes the blur's soft transparent fringe past
                        // the clip edges (the drawer sits flush against the
                        // viewport's right edge, where the fringe would show).
                        className={'absolute h-screen w-screen max-w-none scale-105 object-cover blur-[24px]'}
                        style={{ top: -offset.top, left: -offset.left }}
                    />
                    :
                    null
            }
            <div className={'absolute inset-0 bg-(--modal-background-color)'} />
        </div>
    );
});

export default SnapshotBackdrop;
