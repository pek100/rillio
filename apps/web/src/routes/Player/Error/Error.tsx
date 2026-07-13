// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player error overlay. Restyled onto Tailwind tokens + the kit Button. The code===2
 * external-player hint, the "Try a different source" accent pill, the disk-full
 * "Free up space" (#/cached) CTA and the external-playlist download button are all
 * preserved exactly.
 */

import React, { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';

type Props = {
    className?: string;
    code?: number;
    message?: string;
    stream?: any;
    freeSpace?: boolean;
    onTryDifferentSource?: () => void;
};

const Error = forwardRef<HTMLDivElement, Props>(function Error({ className, code, message, stream, freeSpace, onTryDifferentSource }, ref) {
    const { t } = useTranslation();

    const [playlist, fileName] = useMemo(() => {
        return [
            stream?.deepLinks?.externalPlayer?.playlist,
            stream?.deepLinks?.externalPlayer?.fileName,
        ];
    }, [stream]);

    return (
        <div ref={ref} className={cn('flex flex-col items-center justify-center', className)}>
            <div className={'max-h-[4.8em] flex-[0_1_auto] px-32 text-center text-[2rem] text-fg'} title={message}>{message}</div>
            {
                code === 2 ?
                    <div className={'mt-[0.8rem] max-h-[4.8em] flex-[0_1_auto] px-8 text-center text-[1.3rem] text-fg'} title={t('EXTERNAL_PLAYER_HINT')}>{t('EXTERNAL_PLAYER_HINT')}</div>
                    :
                    null
            }
            {
                typeof onTryDifferentSource === 'function' || freeSpace === true ?
                    <div className={'pointer-events-auto mt-4 flex flex-wrap items-center justify-center gap-2'}>
                        {
                            typeof onTryDifferentSource === 'function' ?
                                <button
                                    type={'button'}
                                    onClick={onTryDifferentSource}
                                    className={'rounded-full bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:brightness-110'}
                                >
                                    Try a different source
                                </button>
                                :
                                null
                        }
                        {
                            freeSpace === true ?
                                <Button
                                    variant="ghost"
                                    href={'#/cached'}
                                    className={'rounded-full bg-surface px-5 py-2 text-sm text-fg transition hover:bg-surface-hover'}
                                >
                                    Free up space
                                </Button>
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
            {
                playlist && fileName ?
                    <Button
                        title={t('PLAYER_OPEN_IN_EXTERNAL')}
                        href={playlist}
                        download={fileName}
                        target={'_blank'}
                        className={'mt-6 flex h-14 flex-row items-center rounded-full bg-accent px-8 transition hover:brightness-110 active:scale-[0.97]'}
                    >
                        <Icon className={'mr-4 size-6 flex-none text-fg'} name={'download'} />
                        <div className={'max-h-[2.4em] flex-1 text-center text-[1.1rem] font-medium text-fg'}>{t('PLAYER_OPEN_IN_EXTERNAL')}</div>
                    </Button>
                    :
                    null
            }
        </div>
    );
});

export default Error;
