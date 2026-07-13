// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { Slider } from 'rillio/components';
import { cn } from 'rillio/components/ui/cn';

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
const THUMB = 'bg-(--color-accent) transition-transform duration-150 group-hover:scale-[1.2] ' +
    "after:absolute after:inset-0 after:rounded-full after:content-[''] " +
    'after:shadow-[0_0_0_0.25rem_var(--color-accent)_inset] after:[filter:brightness(130%)]';

type Props = {
    className?: string;
    time: number | null;
    duration: number | null;
    buffered?: number;
    onSeekRequested?: (time: number) => void;
    onSeekPreview?: (time: number | null) => void;
};

const SeekBar = ({ className, time, duration, buffered, onSeekRequested, onSeekPreview }: Props) => {
    const disabled = time === null || isNaN(time as number) || duration === null || isNaN(duration as number);
    const routeFocused = useRouteFocused();
    const [seekTime, setSeekTime] = useState<number | null>(null);

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
        <div className={cn('flex flex-row items-center', className)}>
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
