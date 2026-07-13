// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import classNames from 'classnames';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { useBinaryState } from 'rillio/common';
import { Slider } from 'rillio/components';
import { Button } from 'rillio/components/ui/button';
import formatTime from './formatTime';

// The seek bar's filled track + thumb are the accent color, with a hover-grown
// thumb carrying an inset accent glow. These were the only reasons SeekBar had its
// own .less (to reach the Slider's hashed part classes); they are now passed straight
// through the Slider's per-part className props.
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
    playbackSpeed?: number | null;
};

const SeekBar = ({ className, time, duration, buffered, onSeekRequested, playbackSpeed }: Props) => {
    const disabled = time === null || isNaN(time as number) || duration === null || isNaN(duration as number);
    const routeFocused = useRouteFocused();
    const [seekTime, setSeekTime] = useState<number | null>(null);

    const [remainingTimeMode, , , toggleRemainingTimeMode] = useBinaryState(false);
    const resetTimeDebounced = useCallback(debounce(() => {
        setSeekTime(null);
    }, 1500), []);
    const onSlide = useCallback((value: number) => {
        resetTimeDebounced.cancel();
        setSeekTime(value);
    }, []);
    const onComplete = useCallback((value: number) => {
        resetTimeDebounced();
        setSeekTime(value);
        if (typeof onSeekRequested === 'function') {
            onSeekRequested(value);
        }
    }, [onSeekRequested]);
    useLayoutEffect(() => {
        if (!routeFocused || disabled) {
            resetTimeDebounced.cancel();
            setSeekTime(null);
        }
    }, [routeFocused, disabled]);
    useEffect(() => {
        return () => {
            resetTimeDebounced.cancel();
        };
    }, []);

    // Timecode labels: fixed width, tabular figures, rtl-ellipsis so long
    // durations trim from the left. Matches the old --primary-foreground look.
    const labelClass = 'w-[5.5rem] flex-none whitespace-nowrap text-center text-[1.1rem] tabular-nums text-fg/90 [direction:rtl] [text-overflow:ellipsis]';

    return (
        <div className={classNames(className, 'flex flex-row items-center')}>
            <div className={labelClass}>{formatTime(seekTime !== null ? seekTime : time)}</div>
            <Slider
                className={'mx-(--thumb-size) flex-1 self-stretch'}
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
            <Button variant="ghost" className="h-auto rounded-none p-0 hover:bg-transparent" onClick={toggleRemainingTimeMode} tabIndex={-1}>
                <div className={labelClass}>
                    {remainingTimeMode && duration !== null && !isNaN(duration)
                        ? formatTime((duration - (time as number)) / (playbackSpeed as number), '-')
                        : formatTime(duration)}
                </div>
            </Button>
        </div>
    );
};

export default SeekBar;
