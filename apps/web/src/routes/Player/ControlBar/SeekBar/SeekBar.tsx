// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { Slider } from 'rillio/components';
import { cn } from 'rillio/components/ui/cn';
import usePlayerThumb from './usePlayerThumb';
import formatTime from './formatTime';

// The seek bar's filled track + thumb are the accent color, with a hover-grown
// thumb carrying an inset accent glow. These were the only reasons SeekBar had its
// own .less (to reach the Slider's hashed part classes); they are now passed straight
// through the Slider's per-part className props.
// Track = faint light (blue-tinted ice at low alpha, not the old orange-at-20%);
// buffered = a slightly stronger ice (reads as "downloaded", still not grey);
// the filled range up to the scrubber and the thumb stay the accent #FFA033.
// The timecode display lives in the ControlBar's time island (not on the bar's
// sides); onSeekPreview streams the scrub position so the island live-updates.
const TRACK = 'bg-ice/10 opacity-100';
const BUFFERED = 'bg-ice/30';
const FILLED = 'bg-(--color-accent)';
const THUMB = 'bg-(--color-accent) transition-transform duration-150 group-hover:scale-[1.2]';

type Props = {
    className?: string;
    time: number | null;
    duration: number | null;
    buffered?: number;
    // The URL mpv is actually playing (video.state.stream.url): what the
    // shell's shadow player opens for trickplay thumbnails. Shell-only.
    thumbStreamUrl?: string | null;
    onSeekRequested?: (time: number) => void;
    onSeekPreview?: (time: number | null) => void;
};

const SeekBar = ({ className, time, duration, buffered, thumbStreamUrl, onSeekRequested, onSeekPreview }: Props) => {
    const disabled = time === null || isNaN(time as number) || duration === null || isNaN(duration as number);
    const routeFocused = useRouteFocused();
    const [seekTime, setSeekTime] = useState<number | null>(null);

    // Trickplay: the fraction of the bar under the cursor. Plain hover only -
    // during a DRAG the window-grab model turns body pointer-events off, so
    // these mouse events stop firing and the preview follows seekTime instead.
    const barRef = useRef<HTMLDivElement | null>(null);
    const [hoverFraction, setHoverFraction] = useState<number | null>(null);
    const onBarMouseMove = useCallback((event: React.MouseEvent) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        setHoverFraction(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    }, []);
    const onBarMouseLeave = useCallback(() => setHoverFraction(null), []);

    // Where the preview sits and what moment it shows: the drag position while
    // scrubbing (seekTime), else the hovered position.
    const previewTimeMs = !disabled ?
        (seekTime !== null ? seekTime : hoverFraction !== null ? hoverFraction * (duration as number) : null)
        :
        null;
    const previewFraction = !disabled && previewTimeMs !== null ? previewTimeMs / (duration as number) : null;
    const thumb = usePlayerThumb(thumbStreamUrl ?? null, previewTimeMs);

    const setSeekTimeAndPreview = useCallback((value: number | null) => {
        setSeekTime(value);
        if (typeof onSeekPreview === 'function') {
            onSeekPreview(value);
        }
    }, [onSeekPreview]);
    const resetTimeDebounced = useCallback(debounce(() => {
        setSeekTimeAndPreview(null);
    }, 1500), [setSeekTimeAndPreview]);
    const onSlide = useCallback((value: number) => {
        resetTimeDebounced.cancel();
        setSeekTimeAndPreview(value);
    }, [setSeekTimeAndPreview]);
    const onComplete = useCallback((value: number) => {
        resetTimeDebounced();
        setSeekTimeAndPreview(value);
        if (typeof onSeekRequested === 'function') {
            onSeekRequested(value);
        }
    }, [onSeekRequested, setSeekTimeAndPreview]);
    useLayoutEffect(() => {
        if (!routeFocused || disabled) {
            resetTimeDebounced.cancel();
            setSeekTimeAndPreview(null);
        }
    }, [routeFocused, disabled]);
    useEffect(() => {
        return () => {
            resetTimeDebounced.cancel();
        };
    }, []);

    return (
        <div
            ref={barRef}
            className={cn('relative flex flex-row items-center overflow-visible', className)}
            onMouseMove={onBarMouseMove}
            onMouseLeave={onBarMouseLeave}
        >
            {
                // Trickplay preview: a small frame + timestamp riding above the
                // cursor/scrub position. The IMAGE only renders when the shell's
                // shadow player has one (shell-only; approximate by keyframe).
                // pointer-events-none: it floats over the bar and must never
                // steal the hover/drag it is following. The overflow-visible on
                // the container is load-bearing against the global reset.
                previewFraction !== null && thumb !== null ?
                    <div
                        className={'pointer-events-none absolute bottom-full mb-3 z-0 -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-black shadow-elevated'}
                        style={{ left: `clamp(5.5rem, ${previewFraction * 100}%, calc(100% - 5.5rem))` }}
                    >
                        <img src={thumb} alt={''} className={'block w-44'} draggable={false} />
                        <div className={'bg-black/80 py-0.5 text-center text-xs tabular-nums text-ice'}>
                            {formatTime(previewTimeMs as number)}
                        </div>
                    </div>
                    :
                    null
            }
            <Slider
                className={'mx-(--thumb-size) flex-1 self-stretch'}
                trackClassName={TRACK}
                bufferedClassName={BUFFERED}
                filledClassName={FILLED}
                thumbClassName={THUMB}
                value={
                    !disabled ?
                        seekTime !== null ? seekTime : (time as number)
                        :
                        0
                }
                buffered={buffered}
                minimumValue={0}
                maximumValue={duration as number}
                disabled={disabled}
                onSlide={onSlide}
                onComplete={onComplete}
            />
        </div>
    );
};

export default SeekBar;
