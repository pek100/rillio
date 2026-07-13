// Copyright (C) 2017-2026 Smart code 203358507

/**
 * A selectable subtitle-variant row plus its right-click actions. Restyled onto
 * Tailwind tokens + the kit Button. The right-click menu uses the shared rillio
 * ContextMenu (now a faithful custom .tsx/Tailwind port kept for its multi-ref `on`
 * + `lock`-to-edge anchoring, which Radix cannot express cleanly); this row anchors
 * it with `lock='bottom'`. The embedded-track guard, download/copy actions and toast
 * feedback are preserved.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from 'rillio/components';
import { Button } from 'rillio/components/ui';
import { languages, useToast } from 'rillio/common';
import { Download, Link, Share2 } from 'lucide-react';
import { cn } from 'rillio/components/ui';

type SubtitlesTrack = {
    id: string,
    addonSubtitleId?: string,
    lang: string,
    origin: string,
    label?: string,
    url?: string,
    fallbackUrl?: string,
    embedded?: boolean,
    local?: boolean,
    exclusive?: boolean,
};

type Props = {
    track: SubtitlesTrack,
    selected: boolean,
    onSelect: (track: SubtitlesTrack) => void,
};

const hasValidLabel = (label?: string) => label && label.length > 0 && !label.startsWith('http');

const CTX_OPTION = 'flex min-w-64 justify-start gap-4 rounded-none px-6 py-5 hover:bg-surface-hover';

const SubtitleVariant = ({ track, selected, onSelect }: Props) => {
    const { t } = useTranslation();
    const toast = useToast();
    const buttonRef = useRef<HTMLElement>(null);
    const triggers = useMemo(() => [buttonRef], []);

    const downloadUrl = track.fallbackUrl || track.url;
    const variantLabel = hasValidLabel(track.label) ? track.label : languages.label(track.lang);
    const downloadFileName = hasValidLabel(track.label) ? track.label : `subtitle-${track.lang || 'unknown'}`;
    const canCopyUrl = typeof downloadUrl === 'string' && !downloadUrl.startsWith('blob:');
    const hoverTitle = hasValidLabel(track.label)
        ? track.label
        : downloadUrl?.split('/').pop()?.split('?')[0] || variantLabel;

    const onSelectClick = useCallback(() => {
        onSelect(track);
    }, [onSelect, track]);

    const copyToClipboard = useCallback((value: string, successKey: string, errorKey: string) => {
        navigator.clipboard.writeText(value)
            .then(() => toast.show({ type: 'success', title: t(successKey), timeout: 4000 }))
            .catch(() => toast.show({ type: 'error', title: t(errorKey), timeout: 4000 }));
    }, [toast, t]);

    const onCopyUrlClick = useCallback(() => {
        if (downloadUrl) {
            copyToClipboard(downloadUrl, 'PLAYER_COPY_SUBTITLE_URL_SUCCESS', 'PLAYER_COPY_SUBTITLE_URL_ERROR');
        }
    }, [downloadUrl, copyToClipboard]);

    const onCopyIdClick = useCallback(() => {
        if (track.addonSubtitleId) {
            copyToClipboard(track.addonSubtitleId, 'PLAYER_COPY_SUBTITLE_ID_SUCCESS', 'PLAYER_COPY_SUBTITLE_ID_ERROR');
        }
    }, [track.addonSubtitleId, copyToClipboard]);

    return (
        <Button
            ref={buttonRef}
            variant={'ghost'}
            title={hoverTitle}
            onClick={onSelectClick}
            className={cn(
                'mb-2 flex h-16 w-full rounded-card px-6 hover:bg-surface-hover',
                selected && 'bg-accent-soft',
            )}
        >
            <div className={'flex flex-1 flex-col gap-1'}>
                <div className={'flex-1 truncate text-[1.1rem] leading-6 text-fg'}>
                    {variantLabel}
                </div>
                <div className={'truncate text-[0.9rem] text-fg-muted'}>
                    {t(track.origin)}
                </div>
            </div>
            {selected ? <div className={'ml-4 size-2 flex-none rounded-full bg-primary'} /> : null}
            {!track.embedded &&
                <ContextMenu on={triggers} autoClose={true} lock={'bottom'}>
                    {downloadUrl ?
                        <Button
                            variant={'ghost'}
                            className={CTX_OPTION}
                            title={t('CTX_DOWNLOAD_SUBTITLE')}
                            href={downloadUrl}
                            target={'_blank'}
                            download={downloadFileName}
                        >
                            <Download className={'size-[1.4rem] flex-none text-fg-muted'} />
                            <div className={'min-w-0 flex-1 truncate text-left font-normal text-fg'}>
                                {t('CTX_DOWNLOAD_SUBTITLE')}
                            </div>
                        </Button>
                        :
                        null
                    }
                    {canCopyUrl ?
                        <Button
                            variant={'ghost'}
                            className={CTX_OPTION}
                            title={t('CTX_COPY_SUBTITLE_URL')}
                            onClick={onCopyUrlClick}
                        >
                            <Link className={'size-[1.4rem] flex-none text-fg-muted'} />
                            <div className={'min-w-0 flex-1 truncate text-left font-normal text-fg'}>
                                {t('CTX_COPY_SUBTITLE_URL')}
                            </div>
                        </Button>
                        :
                        null
                    }
                    {track.addonSubtitleId ?
                        <Button
                            variant={'ghost'}
                            className={CTX_OPTION}
                            title={t('CTX_COPY_SUBTITLE_ID')}
                            onClick={onCopyIdClick}
                        >
                            <Share2 className={'size-[1.4rem] flex-none text-fg-muted'} />
                            <div className={'min-w-0 flex-1 truncate text-left font-normal text-fg'}>
                                {t('CTX_COPY_SUBTITLE_ID')}
                            </div>
                        </Button>
                        :
                        null
                    }
                </ContextMenu>
            }
        </Button>
    );
};

export default SubtitleVariant;
