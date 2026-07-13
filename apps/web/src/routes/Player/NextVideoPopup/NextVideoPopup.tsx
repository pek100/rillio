// Copyright (C) 2017-2026 Smart code 203358507

/**
 * "Up next" card (poster + dual CTA). Restyled onto Tailwind tokens + the kit Button;
 * the countdown trigger lives in Player, and the animationEnd -> focus("Watch now")
 * handoff, the hideSpoilers poster blur and the icon fallback are preserved. Kept as a
 * bespoke card (not a toast): it needs a poster, two actions and autofocus.
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { CONSTANTS, useProfile } from 'rillio/common';
import { Image } from 'rillio/components';
import { Button } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';

type Props = {
    className?: string;
    metaItem?: any;
    nextVideo?: any;
    onDismiss?: () => void;
    onNextVideoRequested?: () => void;
};

const NextVideoPopup = ({ className, metaItem, nextVideo, onDismiss, onNextVideoRequested }: Props) => {
    const { t } = useTranslation();
    const profile = useProfile();
    const blurPosterImage = profile.settings.hideSpoilers && metaItem.type === 'series';
    const watchNowButtonRef = useRef<HTMLElement>(null);
    const [animationEnded, setAnimationEnded] = useState(false);
    const videoName = useMemo(() => {
        const title = (nextVideo && nextVideo.title) || (metaItem && metaItem.title);
        return nextVideo !== null &&
            typeof nextVideo.season === 'number' &&
            typeof nextVideo.episode === 'number' ?
            `${title} (S${nextVideo.season}E${nextVideo.episode})`
            :
            title;
    }, [metaItem, nextVideo]);
    const onAnimationEnd = useCallback(() => {
        setAnimationEnded(true);
    }, []);
    const renderPosterFallback = useCallback(() => {
        return metaItem !== null && typeof metaItem.type === 'string' ?
            <Icon
                className={'h-1/2 w-4/5 flex-none text-fg'}
                name={CONSTANTS.ICON_FOR_TYPE.has(metaItem.type) ? CONSTANTS.ICON_FOR_TYPE.get(metaItem.type) : CONSTANTS.ICON_FOR_TYPE.get('other')}
            />
            :
            null;
    }, [metaItem]);
    const onDismissButtonClick = useCallback(() => {
        if (typeof onDismiss === 'function') {
            onDismiss();
        }
    }, [onDismiss]);
    const onWatchNowButtonClick = useCallback(() => {
        if (typeof onNextVideoRequested === 'function') {
            onNextVideoRequested();
        }
    }, [onNextVideoRequested]);
    useLayoutEffect(() => {
        if (animationEnded === true && watchNowButtonRef.current !== null) {
            watchNowButtonRef.current.focus();
        }
    }, [animationEnded]);
    return (
        <div
            className={cn('flex min-h-[13rem] w-[38rem] flex-row overflow-hidden animate-in fade-in-0 slide-in-from-right-[42rem] duration-500 ease-in', className)}
            onAnimationEnd={onAnimationEnd}
        >
            <div className={'flex flex-[1_1_25%] items-center justify-center bg-(--overlay-color)'}>
                <Image
                    className={cn('h-full w-full flex-none object-cover object-center', blurPosterImage && 'blur-[0.5rem]')}
                    src={nextVideo?.thumbnail}
                    alt={' '}
                    fallbackSrc={metaItem?.poster}
                    renderFallback={renderPosterFallback}
                />
            </div>
            <div className={'flex flex-[1_1_55%] flex-col'}>
                <div className={'flex flex-auto flex-col gap-4 px-8 py-6'}>
                    {
                        typeof metaItem?.name === 'string' ?
                            <div className={'max-h-[2.4em] flex-none self-stretch font-bold text-primary'}>
                                <span className={'text-fg'}>{t('PLAYER_NEXT_VIDEO_TITLE_SHORT')}</span> {metaItem.name}
                            </div>
                            :
                            null
                    }
                    {
                        typeof videoName === 'string' ?
                            <div className={'max-h-[2.4em] flex-none self-stretch font-medium text-fg'}>
                                {videoName}
                            </div>
                            :
                            null
                    }
                </div>
                <div className={'flex flex-row justify-between gap-4 px-4 pb-6'}>
                    <Button
                        variant={'ghost'}
                        onClick={onDismissButtonClick}
                        className={'flex h-14 flex-[0_1_50%] flex-row items-center justify-center gap-4 rounded-full px-4 opacity-60 hover:bg-(--overlay-color) hover:opacity-100'}
                    >
                        <Icon className={'size-[1.4rem] flex-none text-fg'} name={'close'} />
                        <div className={'max-h-[2.4em] flex-none text-[1.1rem] font-medium text-fg'}>{t('PLAYER_NEXT_VIDEO_BUTTON_DISMISS')}</div>
                    </Button>
                    <Button
                        ref={watchNowButtonRef}
                        onClick={onWatchNowButtonClick}
                        className={'flex h-14 flex-[0_1_50%] flex-row items-center justify-center gap-4 rounded-full bg-accent px-4 hover:brightness-110 active:scale-[0.97]'}
                    >
                        <Icon className={'size-[1.4rem] flex-none text-fg'} name={'play'} />
                        <div className={'max-h-[2.4em] flex-none text-[1.1rem] font-medium text-fg'}>{t('PLAYER_NEXT_VIDEO_BUTTON_WATCH')}</div>
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default NextVideoPopup;
