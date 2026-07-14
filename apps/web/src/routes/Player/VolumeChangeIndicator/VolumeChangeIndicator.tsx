// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Transient centered volume HUD shown while the overlay is hidden (wheel/keys while
 * immersed). Reuses the themed read-only VolumeSlider; the icon tiering and the 1.5s
 * auto-hide on volume change are preserved. Restyled onto Tailwind tokens.
 */

import React, { memo, useEffect, useMemo, useRef } from 'react';
import { VolumeX, Volume, Volume1, Volume2 } from 'lucide-react';
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
        return (typeof muted === 'boolean' && muted) ? VolumeX :
            volume === null || isNaN(volume) ? VolumeX :
                volume === 0 ? VolumeX :
                    volume < 30 ? Volume :
                        volume < 70 ? Volume1 :
                            Volume2;
    }, [muted, volume]);
    const VolumeIcon = iconName;

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
                    <div className={'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-4 rounded-card border border-line bg-glass-panel px-10 py-8 shadow-elevated backdrop-blur-(--glass-blur) max-sm:px-6 max-sm:py-4'}>
                        <VolumeIcon className={'size-[6.5rem] text-fg max-sm:size-16'} />
                        <VolumeSlider volume={volume} className={'mx-4 max-h-4 w-[6.5rem] [--thumb-size:1rem] [--track-size:0.35rem] max-sm:w-16'} />
                    </div>
                    :
                    null
            }
        </React.Fragment>
    );
});

export default VolumeChangeIndicator;
