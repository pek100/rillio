// Copyright (C) 2017-2026 Smart code 203358507

import React from 'react';
import classnames from 'classnames';
import styles from './styles.less';

type Props = {
    className?: string,
    ytId?: string | null,
    background?: string | null,
    poster?: string | null,
    name?: string,
};

const SoundOffIcon = () => (
    <svg viewBox={'0 0 20 20'} width={16} height={16} fill={'none'} aria-hidden={'true'}>
        <path d={'M4 7.5h3L11 4v12L7 12.5H4z'} fill={'currentColor'} />
        <path d={'M13.8 8l3.4 4M17.2 8l-3.4 4'} stroke={'currentColor'} strokeWidth={1.6} strokeLinecap={'round'} />
    </svg>
);

const SoundOnIcon = () => (
    <svg viewBox={'0 0 20 20'} width={16} height={16} fill={'none'} aria-hidden={'true'}>
        <path d={'M4 7.5h3L11 4v12L7 12.5H4z'} fill={'currentColor'} />
        <path d={'M13.6 7.6a3.4 3.4 0 010 4.8M15.9 5.6a6.6 6.6 0 010 8.8'} stroke={'currentColor'} strokeWidth={1.6} strokeLinecap={'round'} />
    </svg>
);

// The full-bleed hero banner. A trailer autoplays MUTED and loops, cover-cropped
// to the banner so it fills edge to edge. YouTube's own chrome is hidden
// (controls=0, pointer-events off) and we drive mute/unmute ourselves through
// the iframe JS API, so the viewer clicks one button to hear it. Falls back to
// the backdrop, then the poster.
const HeroMedia = ({ className, ytId, background, poster, name }: Props) => {
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const [muted, setMuted] = React.useState(true);

    const still = background || poster || null;
    const trailerSrc = ytId
        ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${ytId}&iv_load_policy=3&disablekb=1&enablejsapi=1`
        : null;

    const command = React.useCallback((func: string) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    }, []);

    const toggleMute = React.useCallback(() => {
        const nextMuted = !muted;
        command(nextMuted ? 'mute' : 'unMute');
        setMuted(nextMuted);
    }, [muted, command]);

    return (
        <div className={classnames(className, styles['hero-media'])}>
            {
                trailerSrc ?
                    <iframe
                        ref={iframeRef}
                        className={styles['trailer']}
                        src={trailerSrc}
                        title={name || 'Trailer'}
                        allow={'autoplay; encrypted-media; picture-in-picture'}
                        allowFullScreen
                    />
                    :
                    still ?
                        <img className={styles['still']} src={still} alt={name || ''} />
                        :
                        <div className={styles['still-empty']} />
            }
            <div className={styles['scrim']} />
            {
                trailerSrc ?
                    <button
                        type={'button'}
                        className={styles['sound-button']}
                        onClick={toggleMute}
                        title={muted ? 'Unmute' : 'Mute'}
                        aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
                    >
                        {muted ? <SoundOffIcon /> : <SoundOnIcon />}
                    </button>
                    :
                    null
            }
        </div>
    );
};

export default HeroMedia;
