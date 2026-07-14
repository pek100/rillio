// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player options action list. Used TWO ways by Player.js: as a fixed-position, state-driven
 * floating menu-layer (see the researched KEEP note at the menu-layer mount in Player.tsx)
 * AND as the right-click-over-video content inside the shared rillio ContextMenu (now a
 * Radix Popover). Both paths close via the `optionsMenuClosePrevented` nativeEvent flag set
 * in onMouseDown below, which bubbles the React tree to onContainerMouseDown - preserved
 * across the Popover.Portal exactly as it was across the old createPortal. Restyled onto
 * Tailwind tokens + the kit Button; every conditional row, clipboard/toast flow, cache-
 * download and PlayOnDevice dispatch is preserved verbatim.
 */

import React, { forwardRef, memo, ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Magnet, Download } from 'lucide-react';
import { Vlc } from 'rillio/components/ui/brand-icons';
import { useCore } from 'rillio/core';
import { usePlatform, useToast } from 'rillio/common';
import useCacheDownload from 'rillio/common/useCacheDownload';
import { Button } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';
import SnapshotBackdrop from '../SnapshotBackdrop';

type OptionProps = {
    icon: React.ComponentType<{ className?: string }>;
    label: ReactNode;
    deviceId?: string;
    disabled?: boolean;
    onClick?: (deviceId?: string) => void;
};

const Option = ({ icon, label, deviceId, disabled, onClick }: OptionProps) => {
    const IconComp = icon;
    const onButtonClick = useCallback(() => {
        if (typeof onClick === 'function') {
            onClick(deviceId);
        }
    }, [onClick, deviceId]);
    return (
        <Button
            variant={'ghost'}
            disabled={disabled}
            onClick={onButtonClick}
            className={'mb-2 flex h-14 w-full flex-row items-center justify-start rounded-card px-4 last:mb-0 hover:bg-surface-hover'}
        >
            <IconComp className={'mr-4 size-[1.4rem] flex-none text-fg'} />
            <div className={'max-h-[2.4em] flex-1 text-left font-normal text-fg'}>{label}</div>
        </Button>
    );
};

type Props = {
    className?: string;
    stream?: any;
    playbackDevices?: Array<{ id: string; name: string; type: string }>;
    extraSubtitlesTracks?: Array<{ id: string; url?: string; fallbackUrl?: string }>;
    selectedExtraSubtitlesTrackId?: string;
};

const OptionsMenu = memo(forwardRef<HTMLDivElement, Props>(function OptionsMenu({ className, stream, playbackDevices = [], extraSubtitlesTracks, selectedExtraSubtitlesTrackId }, ref) {
    const { t } = useTranslation();
    const core = useCore();
    const platform = usePlatform();
    const toast = useToast();
    const [streamingUrl, downloadUrl, magnetUrl] = useMemo(() => {
        return stream !== null ?
            stream.deepLinks &&
            stream.deepLinks.externalPlayer &&
            [
                stream.deepLinks.externalPlayer.streaming,
                stream.deepLinks.externalPlayer.download,
                stream.deepLinks.externalPlayer.magnet,
            ]
            :
            [null, null, null];
    }, [stream]);
    const externalDevices = useMemo(() => {
        return playbackDevices.filter(({ type }) => type === 'external');
    }, [playbackDevices]);

    const subtitlesTrackUrl = useMemo(() => {
        const track = extraSubtitlesTracks?.find(({ id }) => id === selectedExtraSubtitlesTrackId);
        return track?.fallbackUrl ?? track?.url ?? null;
    }, [extraSubtitlesTracks, selectedExtraSubtitlesTrackId]);

    const onCopyStreamButtonClick = useCallback(() => {
        if (streamingUrl || downloadUrl) {
            navigator.clipboard.writeText(streamingUrl || downloadUrl)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: 'Copied',
                        message: t('PLAYER_COPY_STREAM_SUCCESS'),
                        timeout: 3000,
                    });
                })
                .catch((e) => {
                    console.error(e);
                    toast.show({
                        type: 'error',
                        title: t('ERROR'),
                        message: `${t('PLAYER_COPY_STREAM_ERROR')}: ${streamingUrl || downloadUrl}`,
                        timeout: 3000,
                    });
                });
        }
    }, [streamingUrl, downloadUrl]);
    const onCopyMagnetButtonClick = useCallback(() => {
        if (magnetUrl) {
            navigator.clipboard.writeText(magnetUrl)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: 'Copied',
                        message: t('PLAYER_COPY_MAGNET_LINK_SUCCESS'),
                        timeout: 3000,
                    });
                })
                .catch((e) => {
                    console.error(e);
                    toast.show({
                        type: 'error',
                        title: t('Error'),
                        message: `${t('PLAYER_COPY_MAGNET_LINK_ERROR')}: ${magnetUrl}`,
                        timeout: 3000,
                    });
                });
        }
    }, [magnetUrl]);
    const onDownloadVideoButtonClick = useCallback(() => {
        if (downloadUrl) {
            platform.openExternal(downloadUrl);
        }
    }, [downloadUrl]);

    const downloadToCache = useCacheDownload();
    const onKeepInCacheClick = useCallback(() => {
        downloadToCache(stream);
    }, [downloadToCache, stream]);

    const onDownloadSubtitlesClick = useCallback(() => {
        subtitlesTrackUrl && platform.openExternal(subtitlesTrackUrl);
    }, [subtitlesTrackUrl]);

    const onExternalDeviceRequested = useCallback((deviceId?: string) => {
        if (streamingUrl) {
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'PlayOnDevice',
                    args: {
                        device: deviceId,
                        source: streamingUrl,
                    },
                },
            });
        }
    }, [streamingUrl]);
    const onMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).optionsMenuClosePrevented = true;
    }, []);

    return (
        <div ref={ref} className={cn('w-64 p-4', className)} onMouseDown={onMouseDown}>
            <SnapshotBackdrop />
            {
                streamingUrl || downloadUrl ?
                    <Option
                        icon={Link}
                        label={t('CTX_COPY_STREAM_LINK')}
                        disabled={stream === null}
                        onClick={onCopyStreamButtonClick}
                    />
                    :
                    null
            }
            {
                magnetUrl ?
                    <Option
                        icon={Magnet}
                        label={t('CTX_COPY_MAGNET_LINK')}
                        disabled={stream === null}
                        onClick={onCopyMagnetButtonClick}
                    />
                    :
                    null
            }
            {
                downloadUrl ?
                    <Option
                        icon={Download}
                        label={t('CTX_DOWNLOAD_VIDEO')}
                        disabled={stream === null}
                        onClick={onDownloadVideoButtonClick}
                    />
                    :
                    null
            }
            {
                stream !== null && typeof stream.infoHash === 'string' ?
                    <Option
                        icon={Download}
                        label={'Keep in cache'}
                        disabled={false}
                        onClick={onKeepInCacheClick}
                    />
                    :
                    null
            }
            {
                subtitlesTrackUrl ?
                    <Option
                        icon={Download}
                        label={t('CTX_DOWNLOAD_SUBS')}
                        disabled={stream === null}
                        onClick={onDownloadSubtitlesClick}
                    />
                    :
                    null
            }
            {
                streamingUrl && externalDevices.map(({ id, name }) => (
                    <Option
                        key={id}
                        icon={Vlc}
                        label={t('PLAYER_PLAY_IN', { device: name })}
                        deviceId={id}
                        disabled={stream === null}
                        onClick={onExternalDeviceRequested}
                    />
                ))
            }
        </div>
    );
}));

export default OptionsMenu;
