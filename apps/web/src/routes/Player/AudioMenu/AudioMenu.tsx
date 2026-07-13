// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Audio-track picker. State-driven single-select list panel (immersion + closePrevented
 * contract), restyled onto Tailwind tokens + the kit Button. Same rows, same dispatch.
 */

import React, { forwardRef, memo, MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { languages } from 'rillio/common';
import { Button } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';

type Props = {
    className?: string;
    selectedAudioTrackId: string | null;
    audioTracks: AudioTrack[];
    onAudioTrackSelected: (id: string) => void;
};

const AudioMenu = memo(forwardRef<HTMLDivElement, Props>(function AudioMenu({ className, selectedAudioTrackId, audioTracks, onAudioTrackSelected }, ref) {
    const { t } = useTranslation();

    const onAudioTrackClick = useCallback(({ currentTarget }: MouseEvent) => {
        const id = currentTarget.getAttribute('data-id')!;
        onAudioTrackSelected && onAudioTrackSelected(id);
    }, [onAudioTrackSelected]);

    const onMouseDown = (event: MouseEvent) => {
        (event.nativeEvent as any).audioMenuClosePrevented = true;
    };

    return (
        <div ref={ref} className={cn('flex flex-row', className)} onMouseDown={onMouseDown}>
            <div className={'flex max-h-[25rem] w-64 flex-none flex-col self-stretch'}>
                <div className={'flex-none self-stretch px-8 py-6 font-bold text-fg'}>
                    {t('AUDIO_TRACKS')}
                </div>
                <div className={'flex flex-1 flex-col gap-2 self-stretch overflow-y-auto px-4 pb-4'}>
                    {
                        audioTracks.map(({ id, label, lang }, index) => {
                            const selected = selectedAudioTrackId === id;
                            return (
                                <Button
                                    key={index}
                                    variant={'ghost'}
                                    title={label}
                                    data-id={id}
                                    onClick={onAudioTrackClick}
                                    className={cn(
                                        'flex h-16 w-full flex-none flex-row items-center gap-4 rounded-card px-6 hover:bg-surface-hover',
                                        selected && 'bg-accent-soft',
                                    )}
                                >
                                    <div className={'flex flex-1 flex-col gap-1 overflow-hidden text-left'}>
                                        <div className={'truncate text-[1.1rem] leading-6 text-fg'}>
                                            {languages.label(lang)}
                                        </div>
                                        <div className={'truncate text-[0.9rem] text-fg-muted'}>
                                            {label}
                                        </div>
                                    </div>
                                    {selected ? <div className={'size-2 flex-none rounded-full bg-primary'} /> : null}
                                </Button>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}));

export default AudioMenu;
