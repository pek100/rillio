import React, { forwardRef, useMemo } from 'react';
import classNames from 'classnames';
import { Image } from 'rillio/components';
import styles from './Buffering.less';

type Props = {
    className: string,
    logo: string,
    progress: number,
    infoHash?: string | null,
    loaded?: boolean,
    hasStatistics?: boolean,
    peers?: number,
    speed?: number,
    completed?: number,
};

// Pre-playback status panel for torrent streams. When a torrent has been added
// but playback has not started yet, the bare pulsing logo does not explain why,
// so we surface the honest reason (buffering) plus the numbers that decide it:
// how much has downloaded, the current speed, and how many peers we are pulling
// from. All stats are optional-chained with defaults, so missing stats fall
// back to a plain "Buffering" without numbers rather than crashing.
const Buffering = forwardRef<HTMLDivElement, Props>(({ className, logo, progress, infoHash, loaded, hasStatistics, peers, speed, completed }, ref) => {
    const style = useMemo(() => {
        return {
            clipPath: `inset(0 ${100 - progress}% 0 0)`,
        };
    }, [progress]);

    // Only a torrent stream that has not started playing yet gets the panel;
    // direct (non-torrent) streams have no infoHash, and once loaded is true the
    // "before playback can begin" wording no longer applies.
    const showStatus = typeof infoHash === 'string' && infoHash.length > 0 && !loaded;

    const peerCount = peers ?? 0;
    const speedValue = speed ?? 0;
    const completedValue = Math.min(Math.max(completed ?? 0, 0), 100);
    // A source with peers but a near-zero rate is stalled or slow; with no peers
    // it is simply still finding sources, which is a different (honest) message.
    const slow = hasStatistics === true && peerCount > 0 && speedValue < 0.5;

    return (
        <div ref={ref} className={classNames(className, styles['buffering'])}>
            <Image
                className={styles['logo']}
                style={style}
                src={logo}
                alt={' '}
                fallbackSrc={require('/assets/images/symbol.svg')}
            />
            <Image
                className={classNames(styles['logo'], styles['background'])}
                src={logo}
                alt={' '}
                fallbackSrc={require('/assets/images/symbol.svg')}
            />
            {
                showStatus ?
                    <div className="pointer-events-none absolute bottom-[16%] left-1/2 flex w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 flex-col items-center gap-2 px-6 text-center">
                        <div className="text-sm font-semibold uppercase tracking-[0.08em] text-fg">
                            Initializing
                        </div>
                        {
                            hasStatistics === true ?
                                <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-fg-muted">
                                    <span>{completedValue}% downloaded</span>
                                    <span className="text-fg-subtle">·</span>
                                    <span>{speedValue} MB/s</span>
                                    <span className="text-fg-subtle">·</span>
                                    <span>{peerCount === 1 ? '1 peer' : `${peerCount} peers`}</span>
                                </div>
                                :
                                null
                        }
                        <div className="text-xs leading-relaxed text-fg-subtle">
                            Waiting for enough of the video to download before playback can begin.
                        </div>
                        {
                            slow ?
                                <div className="text-xs leading-relaxed text-warning">
                                    This source is downloading slowly, playback will start once enough has buffered.
                                </div>
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
        </div>
    );
});

export default Buffering;
