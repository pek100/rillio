// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Transient centered volume HUD shown while the overlay is hidden (wheel/keys while
 * immersed). Reuses the themed read-only VolumeSlider; the icon tiering and the 1.5s
 * auto-hide on volume change are preserved. Restyled onto Tailwind tokens.
 */

import React, { memo, useEffect, useMemo, useRef } from 'react';
import Icon from '@stremio/stremio-icons/react';
import { useBinaryState } from 'rillio/common';
import VolumeSlider from '../ControlBar/VolumeSlider';

type Props = {
    muted?: boolean;
    volume: number | null;
};

const VolumeChangeIndicator = memo(function VolumeChangeIndicator({ muted, volume }: Props) {
    const [volumeIndicatorOpen, openVolumeIndicator, closeVolumeIndicator] = useBinaryState(false);
    const volumeChangeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevVolume = useRef(volume);

    const iconName = useMemo(() => {
        return (typeof muted === 'boolean' && muted) ? 'volume-mute' :
            volume === null || isNaN(volume) ? 'volume-off' :
                volume === 0 ? 'volume-mute' :
                    volume < 30 ? 'volume-low' :
                        volume < 70 ? 'volume-medium' :
                            'volume-high';
    }, [muted, volume]);

    useEffect(() => {
        if (prevVolume.current !== volume) {
            openVolumeIndicator();
            if (volumeChangeTimeout.current) clearTimeout(volumeChangeTimeout.current);
            volumeChangeTimeout.current = setTimeout(closeVolumeIndicator, 1500);
        }

        prevVolume.current = volume;
    }, [volume]);

    useEffect(() => {
        return () => {
            if (volumeChangeTimeout.current) clearTimeout(volumeChangeTimeout.current);
        };
    }, []);

    return (
        <React.Fragment>
            {
                volumeIndicatorOpen ?
                    <div className={'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-4 rounded-card bg-(--modal-background-color) px-10 py-8 shadow-(--outer-glow) max-sm:px-6 max-sm:py-4'}>
                        <Icon name={iconName} className={'size-[6.5rem] text-fg max-sm:size-16'} />
                        <VolumeSlider volume={volume} className={'mx-4 max-h-4 w-[6.5rem] [--thumb-size:1rem] [--track-size:0.35rem] max-sm:w-16'} />
                    </div>
                    :
                    null
            }
        </React.Fragment>
    );
});

export default VolumeChangeIndicator;
