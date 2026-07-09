// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const classNames = require('classnames');
const PropTypes = require('prop-types');
const { usePlatform } = require('rillio/common');
const styles = require('./styles.less');

const DASH = '—';

function resolutionLabel(w, h) {
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

function bitDepth(pixelformat) {
    if (typeof pixelformat !== 'string') return DASH;
    if (/016|12le|12be|12$/.test(pixelformat)) return '12-bit';
    if (/010|10le|10be|10$/.test(pixelformat)) return '10-bit';
    return '8-bit';
}

function hdrLabel(vp) {
    if (!vp || typeof vp.gamma !== 'string') return 'SDR';
    if (vp.gamma === 'pq') return 'HDR10 / Dolby Vision (PQ)';
    if (vp.gamma === 'hlg') return 'HLG';
    return `SDR (${vp.gamma})`;
}

function fpsLabel(stats) {
    const fps = stats['container-fps'] || stats['estimated-vf-fps'];
    return typeof fps === 'number' && isFinite(fps) ? `${fps.toFixed(3).replace(/\.?0+$/, '')} fps` : DASH;
}

function bitrate(v, unit) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return DASH;
    const div = unit === 'Mbps' ? 1e6 : 1e3;
    return `${(v / div).toFixed(unit === 'Mbps' ? 2 : 0)} ${unit}`;
}

function hwdecLabel(v) {
    if (typeof v !== 'string' || v === '' || v === 'no') return 'Software';
    return `Hardware (${v})`;
}

function bytes(v) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return DASH;
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
    return `${(v / 1024).toFixed(0)} KB`;
}

function upper(v) {
    return typeof v === 'string' && v.length ? v.toUpperCase() : DASH;
}

const DetailRow = ({ label, value }) => (
    <div className={styles['detail-row']}>
        <div className={styles['detail-label']}>{label}</div>
        <div className={styles['detail-value']}>{value}</div>
    </div>
);
DetailRow.propTypes = { label: PropTypes.string, value: PropTypes.node };

const StatisticsMenu = React.memo(React.forwardRef(({ className, peers, speed, completed, infoHash, details }, ref) => {
    const { t } = useTranslation();
    const platform = usePlatform();
    const [expanded, setExpanded] = React.useState(false);
    const [mpv, setMpv] = React.useState({});

    const onMouseDown = React.useCallback((event) => {
        event.nativeEvent.statisticsMenuClosePrevented = true;
    }, []);

    const toggleExpanded = React.useCallback(() => setExpanded((v) => !v), []);

    React.useEffect(() => {
        if (!expanded) return undefined;
        let alive = true;
        const poll = () => {
            platform.shell?.getMpvStats?.().then((s) => {
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

    return (
        <div ref={ref} className={classNames(className, styles['statistics-menu-container'])} onMouseDown={onMouseDown}>
            <div className={styles['title']}>
                {t('PLAYER_STATISTICS')}
            </div>
            <div className={styles['stats']}>
                <div className={styles['stat']}>
                    <div className={styles['label']}>{t('PLAYER_PEERS')}</div>
                    <div className={styles['value']}>{ peers }</div>
                </div>
                <div className={styles['stat']}>
                    <div className={styles['label']}>{t('PLAYER_SPEED')}</div>
                    <div className={styles['value']}>{`${speed} ${t('MB_S')}`}</div>
                </div>
                <div className={styles['stat']}>
                    <div className={styles['label']}>{t('PLAYER_COMPLETED')}</div>
                    <div className={styles['value']}>{ Math.min(completed, 100) } %</div>
                </div>
            </div>
            <div className={styles['info-hash']}>
                <div className={styles['label']}>{t('PLAYER_INFO_HASH')}</div>
                <div className={styles['value']}>{ infoHash }</div>
            </div>
            {
                canShowMore ?
                    <div className={styles['show-more']} onClick={toggleExpanded}>
                        {expanded ? t('SHOW_LESS') : t('SHOW_MORE')}
                    </div>
                    :
                    null
            }
            {
                expanded ?
                    <div className={styles['details']}>
                        <div className={styles['detail-section']}>
                            <div className={styles['detail-section-title']}>Video</div>
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
                        <div className={styles['detail-section']}>
                            <div className={styles['detail-section-title']}>Audio</div>
                            <DetailRow label={'Codec'} value={upper(mpv['audio-codec-name'] || mpv['audio-codec'])} />
                            <DetailRow label={'Channels'} value={ap ? (ap.channels || ap['channel-count'] || DASH) : DASH} />
                            <DetailRow label={'Sample rate'} value={ap && ap.samplerate ? `${(ap.samplerate / 1000).toFixed(1)} kHz` : DASH} />
                            <DetailRow label={'Bitrate'} value={bitrate(mpv['audio-bitrate'], 'kbps')} />
                        </div>
                        <div className={styles['detail-section']}>
                            <div className={styles['detail-section-title']}>Transfer</div>
                            <DetailRow label={'Downloaded'} value={bytes(net.downloaded)} />
                            <DetailRow label={'Uploaded'} value={bytes(net.uploaded)} />
                            <DetailRow label={'File size'} value={bytes(net.streamLen)} />
                            <DetailRow label={'Container'} value={upper(mpv['file-format'])} />
                        </div>
                        {!hasMedia ?
                            <div className={styles['detail-hint']}>Waiting for playback… media details appear once mpv starts decoding.</div>
                            : null}
                    </div>
                    :
                    null
            }
        </div>
    );
}));

StatisticsMenu.propTypes = {
    className: PropTypes.string,
    peers: PropTypes.number,
    speed: PropTypes.number,
    completed: PropTypes.number,
    infoHash: PropTypes.string,
    details: PropTypes.object,
};

module.exports = StatisticsMenu;
