// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Playback-speed picker. Fixed-position, state-driven floating <div> (opened from Player
 * state, not a menu/popover trigger) whose close rides native mousedown bubbling to the
 * Player's onContainerMouseDown; see the researched KEEP note at the menu-layer mount in
 * Player.tsx for why no 2026 primitive fits. Restyled onto Tailwind tokens + the kit
 * Button; same reversed 0.25x..2.0x rates, same dispatch.
 */

import React, { forwardRef, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';
import SnapshotBackdrop from '../SnapshotBackdrop';

const RATES = Array.from(Array(8).keys(), (n) => n * 0.25 + 0.25).reverse();

type Props = {
    className?: string;
    playbackSpeed?: number | null;
    onPlaybackSpeedChanged?: (value: number) => void;
};

const SpeedMenu = memo(forwardRef<HTMLDivElement, Props>(function SpeedMenu({ className, playbackSpeed, onPlaybackSpeedChanged }, ref) {
    const { t } = useTranslation();
    const onMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).speedMenuClosePrevented = true;
    }, []);
    const onOptionSelect = useCallback((value: number) => {
        if (typeof onPlaybackSpeedChanged === 'function') {
            onPlaybackSpeedChanged(value);
        }
    }, [onPlaybackSpeedChanged]);
    return (
        <div ref={ref} className={cn('w-56', className)} onMouseDown={onMouseDown}>
            <SnapshotBackdrop />
            <div className={'px-8 py-6 font-bold text-fg'}>
                {t('PLAYBACK_SPEED')}
            </div>
            <div className={'max-h-[32rem] px-4 pb-2'}>
                {
                    RATES.map((rate) => {
                        const selected = rate === playbackSpeed;
                        return (
                            <Button
                                key={rate}
                                variant={'ghost'}
                                className={cn(
                                    'mb-2 flex h-[3.2rem] w-full flex-row items-center rounded-card px-6 hover:bg-surface-hover',
                                    selected && 'bg-accent-soft',
                                )}
                                onClick={() => onOptionSelect(rate)}
                            >
                                <div className={'flex-1 text-left font-normal text-fg'}>{rate}x</div>
                                {selected ? <div className={'ml-4 size-2 flex-none rounded-full bg-primary'} /> : null}
                            </Button>
                        );
                    })
                }
            </div>
        </div>
    );
}));

export default SpeedMenu;
