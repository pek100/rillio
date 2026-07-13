// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player statistics panel. A bespoke media-diagnostics readout tied to mpv fields;
 * every formatter and the 1s getMpvStats poll effect are preserved verbatim. Restyled
 * onto Tailwind tokens with the divide-y label|value row idiom. State-driven layer, so
 * the closePrevented mousedown protocol is kept.
 */

import React, { forwardRef, memo, ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatform } from 'rillio/common';
import { cn } from 'rillio/components/ui';

const DASH = '—';

function resolutionLabel(w: number, h: number) {
    if (!w || !h) return DASH;
    let tier = '';
    if (w >= 7680) tier = ' (8K)';
    else if (w >= 3840) tier = ' (4K UHD)';
    else if (w >= 2560) tier = ' (1440p)';
    else if (w >= 1920) tier = ' (1080p)';
    else if (w >= 1280) tier = ' (720p)';
    else if (w >= 640) tier = ' (SD)';
    return `${w} × ${h}${tier}`;
}

function bitDepth(pixelformat: unknown) {
    if (typeof pixelformat !== 'string') return DASH;
    if (/016|12le|12be|12$/.test(pixelformat)) return '12-bit';
    if (/010|10le|10be|10$/.test(pixelformat)) return '10-bit';
    return '8-bit';
}

function hdrLabel(vp: any) {
    if (!vp || typeof vp.gamma !== 'string') return DASH;
    if (vp.gamma === 'pq') return 'HDR10 / Dolby Vision (PQ)';
    if (vp.gamma === 'hlg') return 'HLG';
    return `SDR (${vp.gamma})`;
}

function fpsLabel(stats: any) {
    const fps = stats['container-fps'] || stats['estimated-vf-fps'];
    return typeof fps === 'number' && isFinite(fps) ? `${fps.toFixed(3).replace(/\.?0+$/, '')} fps` : DASH;
}

function bitrate(v: unknown, unit: string) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return DASH;
    const div = unit === 'Mbps' ? 1e6 : 1e3;
    return `${(v / div).toFixed(unit === 'Mbps' ? 2 : 0)} ${unit}`;
}

function hwdecLabel(v: unknown) {
    if (typeof v !== 'string' || v === '') return DASH;
    if (v === 'no') return 'Software';
    return `Hardware (${v})`;
}

function bytes(v: unknown) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return DASH;
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
    return `${(v / 1024).toFixed(0)} KB`;
}

function upper(v: unknown) {
    return typeof v === 'string' && v.length ? v.toUpperCase() : DASH;
}

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className={'flex flex-row items-baseline gap-4'}>
        <div className={'w-40 flex-none font-medium text-fg-muted'}>{label}</div>
        <div className={'flex-auto break-words font-medium text-fg'}>{value}</div>
    </div>
);

type Props = {
    className?: string;
    peers?: number;
    speed?: number;
    completed?: number;
    infoHash?: string;
    details?: any;
};

const StatisticsMenu = memo(forwardRef<HTMLDivElement, Props>(function StatisticsMenu({ className, peers, speed, completed, infoHash, details }, ref) {
    const { t } = useTranslation();
    const platform = usePlatform();
    const [expanded, setExpanded] = useState(false);
    const [mpv, setMpv] = useState<any>({});

    const onMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).statisticsMenuClosePrevented = true;
    }, []);

    const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

    useEffect(() => {
        if (!expanded) return undefined;
        let alive = true;
        const poll = () => {
            platform.shell?.getMpvStats?.().then((s: any) => {
                if (alive && s) setMpv(s);
            }).catch(() => { /* noop */ });
        };
        poll();
        const interval = setInterval(poll, 1000);
        return () => { alive = false; clearInterval(interval); };
    }, [expanded, platform.shell]);

    const canShowMore = !!platform.shell?.active;
    const vp = (mpv && typeof mpv['video-params'] === 'object') ? mpv['video-params'] : null;
    const ap = (mpv && typeof mpv['audio-params'] === 'object') ? mpv['audio-params'] : null;
    const width = (vp && vp.w) || mpv['width'];
    const height = (vp && vp.h) || mpv['height'];
    const hasMedia = !!(vp || mpv['video-codec']);
    const net = details || {};
    const hasTorrent = typeof infoHash === 'string' && infoHash.length > 0;

    return (
        <div ref={ref} className={cn('flex w-[30rem] flex-col gap-6 p-6', className)} onMouseDown={onMouseDown}>
            <div className={'flex-none font-bold text-fg'}>
                {t('PLAYER_STATISTICS')}
            </div>
            {
                hasTorrent ?
                    <React.Fragment>
                        <div className={'flex flex-auto flex-row flex-wrap justify-between gap-4'}>
                            <div className={'flex flex-auto flex-row gap-2'}>
                                <div className={'flex-none font-medium text-fg-muted'}>{t('PLAYER_PEERS')}</div>
                                <div className={'flex-none font-medium text-fg'}>{peers}</div>
                            </div>
                            <div className={'flex flex-auto flex-row gap-2'}>
                                <div className={'flex-none font-medium text-fg-muted'}>{t('PLAYER_SPEED')}</div>
                                <div className={'flex-none font-medium text-fg'}>{`${speed} ${t('MB_S')}`}</div>
                            </div>
                            <div className={'flex flex-auto flex-row gap-2'}>
                                <div className={'flex-none font-medium text-fg-muted'}>{t('PLAYER_COMPLETED')}</div>
                                <div className={'flex-none font-medium text-fg'}>{Math.min(completed as number, 100)} %</div>
                            </div>
                        </div>
                        <div className={'flex flex-auto flex-col gap-2'}>
                            <div className={'flex-none font-medium text-fg-muted'}>{t('PLAYER_INFO_HASH')}</div>
                            <div className={'flex-none break-words font-medium text-fg'}>{infoHash}</div>
                        </div>
                    </React.Fragment>
                    :
                    null
            }
            {
                canShowMore ?
                    <div className={'flex-none cursor-pointer self-start font-semibold text-primary opacity-90 hover:opacity-100'} onClick={toggleExpanded}>
                        {expanded ? t('SHOW_LESS') : t('SHOW_MORE')}
                    </div>
                    :
                    null
            }
            {
                !hasTorrent && !canShowMore ?
                    <div className={'flex-none font-medium text-fg-muted'}>No statistics available for this stream.</div>
                    :
                    null
            }
            {
                expanded ?
                    <div className={'flex max-h-[45vh] flex-none flex-col gap-5 overflow-y-auto'}>
                        <div className={'flex flex-none flex-col gap-[0.4rem]'}>
                            <div className={'flex-none border-b border-line pb-1 font-bold text-fg opacity-90'}>Video</div>
                            <DetailRow label={'Codec'} value={upper(mpv['video-codec'])} />
                            <DetailRow label={'Resolution'} value={resolutionLabel(width, height)} />
                            <DetailRow label={'Frame rate'} value={fpsLabel(mpv)} />
                            <DetailRow label={'Bit depth'} value={vp ? bitDepth(vp.pixelformat) : DASH} />
                            <DetailRow label={'Dynamic range'} value={hdrLabel(vp)} />
                            <DetailRow label={'Color primaries'} value={vp && vp.primaries ? vp.primaries.toUpperCase() : DASH} />
                            {vp && (vp['max-cll'] || vp['max-luma']) ?
                                <DetailRow label={'HDR mastering'} value={`MaxCLL ${vp['max-cll'] ?? DASH} · MaxLuma ${vp['max-luma'] ?? DASH} nits`} />
                                : null}
                            <DetailRow label={'Pixel format'} value={vp && vp.pixelformat ? vp.pixelformat : DASH} />
                            <DetailRow label={'Bitrate'} value={bitrate(mpv['video-bitrate'], 'Mbps')} />
                            <DetailRow label={'Decoding'} value={hwdecLabel(mpv['hwdec-current'])} />
                        </div>
                        <div className={'flex flex-none flex-col gap-[0.4rem]'}>
                            <div className={'flex-none border-b border-line pb-1 font-bold text-fg opacity-90'}>Audio</div>
                            <DetailRow label={'Codec'} value={upper(mpv['audio-codec-name'] || mpv['audio-codec'])} />
                            <DetailRow label={'Channels'} value={ap ? (ap.channels || ap['channel-count'] || DASH) : DASH} />
                            <DetailRow label={'Sample rate'} value={ap && ap.samplerate ? `${(ap.samplerate / 1000).toFixed(1)} kHz` : DASH} />
                            <DetailRow label={'Bitrate'} value={bitrate(mpv['audio-bitrate'], 'kbps')} />
                        </div>
                        <div className={'flex flex-none flex-col gap-[0.4rem]'}>
                            <div className={'flex-none border-b border-line pb-1 font-bold text-fg opacity-90'}>Transfer</div>
                            <DetailRow label={'Downloaded'} value={bytes(net.downloaded)} />
                            <DetailRow label={'Uploaded'} value={bytes(net.uploaded)} />
                            <DetailRow label={'File size'} value={bytes(net.streamLen)} />
                            <DetailRow label={'Container'} value={upper(mpv['file-format'])} />
                        </div>
                        {!hasMedia ?
                            <div className={'flex-none font-medium text-fg-muted'}>Waiting for playback… media details appear once mpv starts decoding.</div>
                            : null}
                    </div>
                    :
                    null
            }
        </div>
    );
}));

export default StatisticsMenu;
