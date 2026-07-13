// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { usePlatform } from 'rillio/common';
import { Slider } from 'rillio/components';
import { cn } from 'rillio/components/ui/cn';

// The volume slider's track is a neutral overlay bar, its filled range + thumb are
// the foreground color, and the thumb grows (with a white inset glow) on hover or
// while sliding. These were the whole reason VolumeSlider had a .less reaching the
// Slider's hashed part classes; they are now passed via the Slider's per-part props.
// (The >100% audio-boost band is owned by the Slider itself via the audioBoost prop.)
const TRACK = 'bg-(--overlay-color) opacity-100';
const FILLED = 'bg-(--color-fg)';
const THUMB = 'bg-(--color-fg) transition-transform duration-150 ' +
    'group-hover:scale-[1.2] group-[.active]:scale-[1.2] ' +
    "after:absolute after:inset-0 after:rounded-full after:content-[''] " +
    'after:shadow-[0_0_0_0.25rem_white_inset]';

type Props = {
    className?: string;
    volume: number | null;
    onVolumeChangeRequested?: (volume: number) => void;
    muted?: boolean;
};

const VolumeSlider = ({ className, volume, onVolumeChangeRequested, muted }: Props) => {
    const { shell } = usePlatform();
    const disabled = volume === null || isNaN(volume as number);
    const routeFocused = useRouteFocused();
    const [slidingVolume, setSlidingVolume] = useState<number | null>(null);
    const maxVolume = shell.active ? 200 : 100;
    const resetVolumeDebounced = useCallback(debounce(() => {
        setSlidingVolume(null);
    }, 100), []);
    const onSlide = useCallback((value: number) => {
        resetVolumeDebounced.cancel();
        setSlidingVolume(value);
        if (typeof onVolumeChangeRequested === 'function') {
            onVolumeChangeRequested(value);
        }
    }, [onVolumeChangeRequested]);
    const onComplete = useCallback((value: number) => {
        resetVolumeDebounced();
        setSlidingVolume(value);
        if (typeof onVolumeChangeRequested === 'function') {
            onVolumeChangeRequested(value);
        }
    }, [onVolumeChangeRequested]);
    useLayoutEffect(() => {
        if (!routeFocused || disabled) {
            resetVolumeDebounced.cancel();
            setSlidingVolume(null);
        }
    }, [routeFocused, disabled]);
    useEffect(() => {
        return () => {
            resetVolumeDebounced.cancel();
        };
    }, []);
    return (
        <Slider
            className={cn({ 'active': slidingVolume !== null }, className)}
            trackClassName={!disabled ? TRACK : undefined}
            filledClassName={!disabled ? FILLED : undefined}
            thumbClassName={!disabled ? THUMB : undefined}
            value={
                !disabled ?
                    !muted ?
                        slidingVolume !== null ? slidingVolume : (volume as number)
                        : 0
                    :
                    100
            }
            minimumValue={0}
            maximumValue={maxVolume}
            disabled={disabled}
            onSlide={onSlide}
            onComplete={onComplete}
            audioBoost={!!shell.active}
        />
    );
};

export default VolumeSlider;
