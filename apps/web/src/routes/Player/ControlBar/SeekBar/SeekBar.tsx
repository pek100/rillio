// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import classNames from 'classnames';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { useBinaryState } from 'rillio/common';
import { Button, Slider } from 'rillio/components';
import formatTime from './formatTime';
import styles from './SeekBar.less';

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
                className={classNames(styles['slider'], { 'active': seekTime !== null })}
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
            <Button onClick={toggleRemainingTimeMode} tabIndex={-1}>
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
