// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import classNames from 'classnames';
import debounce from 'lodash.debounce';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { usePlatform } from 'rillio/common';
import { Slider } from 'rillio/components';
import styles from './VolumeSlider.less';

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
            className={classNames(className, styles['volume-slider'], { 'active': slidingVolume !== null })}
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
