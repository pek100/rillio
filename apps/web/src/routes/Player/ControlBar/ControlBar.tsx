// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player control bar. Clean-room restyle onto the kit IconButton + Tailwind tokens;
 * every handler, the closePrevented mousedown protocol, tabIndex=-1, the play/pause
 * icon-swap, volume tiering, scale-cycle, the mobile overflow popover and the touch
 * forwarding are preserved verbatim. The custom rillio Slider (SeekBar / VolumeSlider)
 * is kept. No <video> is owned here - all state arrives via props from Player.
 *
 * Disabled buttons are DIMMED only (opacity), never pointer-blocked: the onClick
 * handlers self-guard exactly as before, matching the old `.disabled` icon-dim look.
 */

import React, { forwardRef, useCallback, useEffect, useState } from 'react';
import Icon from '@stremio/stremio-icons/react';
import { t } from 'i18next';
import { useServices } from 'rillio/services';
import { useBinaryState, usePlatform, useFullscreen } from 'rillio/common';
import { IconButton } from 'rillio/components/ui';
import { cn } from 'rillio/components/ui';
import SeekBar from './SeekBar';
import VolumeSlider from './VolumeSlider';

// 4rem square bare-glyph button in the control-bar idiom: full-opacity glyph,
// brightness hover (not a bg tint), press-scale, and a dim (not blocked) disabled.
const CB_BUTTON = 'size-16 rounded-full bg-transparent opacity-100 hover:bg-transparent hover:opacity-100 hover:brightness-110 active:scale-[0.97] [&_svg]:size-[2.2rem] [&_svg]:text-fg';
const CB_ICON = 'size-[2.2rem]';

type Props = {
    className?: string;
    paused?: boolean | null;
    time?: number | null;
    duration?: number | null;
    buffered?: number;
    volume?: number | null;
    muted?: boolean | null;
    playbackSpeed?: number | null;
    subtitlesTracks?: unknown[];
    audioTracks?: unknown[];
    metaItem?: { content?: { videos?: unknown[] } } | null;
    nextVideo?: unknown | null;
    stream?: unknown | null;
    videoScale?: string | null;
    videoScaleLabel?: string;
    onVideoScaleChanged?: () => void;
    onPlayRequested?: () => void;
    onPauseRequested?: () => void;
    onNextVideoRequested?: () => void;
    onMuteRequested?: () => void;
    onUnmuteRequested?: () => void;
    onVolumeChangeRequested?: (volume: number) => void;
    onSeekRequested?: (time: number) => void;
    onToggleSubtitlesMenu?: () => void;
    onToggleAudioMenu?: () => void;
    onToggleSpeedMenu?: () => void;
    onToggleSideDrawer?: () => void;
    onToggleOptionsMenu?: () => void;
    onToggleStatisticsMenu?: () => void;
    onMouseOver?: (event: React.MouseEvent) => void;
    onMouseMove?: (event: React.MouseEvent) => void;
    onTouchEnd?: (event: React.TouchEvent) => void;
};

const ControlBar = forwardRef<HTMLDivElement, Props>(function ControlBar({
    className,
    paused,
    time,
    duration,
    buffered,
    volume,
    muted,
    playbackSpeed,
    subtitlesTracks,
    audioTracks,
    metaItem,
    nextVideo,
    stream,
    onPlayRequested,
    onPauseRequested,
    onNextVideoRequested,
    onMuteRequested,
    onUnmuteRequested,
    onVolumeChangeRequested,
    onSeekRequested,
    onToggleSubtitlesMenu,
    onToggleAudioMenu,
    onToggleSpeedMenu,
    onToggleSideDrawer,
    onToggleOptionsMenu,
    videoScale,
    videoScaleLabel,
    onVideoScaleChanged,
    onToggleStatisticsMenu,
    onTouchEnd,
    ...props
}, ref) {
    const { chromecast } = useServices();
    const platform = usePlatform();
    // Fullscreen lives here (next to the scale/fit control), not on the player's
    // top bar, that one duplicates the window header's fullscreen in the shell.
    const [fullscreen, requestFullscreen, exitFullscreen, , fullscreenSupported] = useFullscreen();
    const [chromecastServiceActive, setChromecastServiceActive] = useState(() => chromecast.active);
    const [buttonsMenuOpen, , , toggleButtonsMenu] = useBinaryState(false);
    const onSubtitlesButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).subtitlesMenuClosePrevented = true;
    }, []);
    const onAudioButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).audioMenuClosePrevented = true;
    }, []);
    const onSpeedButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).speedMenuClosePrevented = true;
    }, []);
    const onVideosButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).videosMenuClosePrevented = true;
    }, []);
    const onOptionsButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).optionsMenuClosePrevented = true;
    }, []);
    const onStatisticsButtonMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).statisticsMenuClosePrevented = true;
    }, []);
    const onPlayPauseButtonClick = useCallback(() => {
        if (paused) {
            if (typeof onPlayRequested === 'function') {
                onPlayRequested();
            }
        } else {
            if (typeof onPauseRequested === 'function') {
                onPauseRequested();
            }
        }
    }, [paused, onPlayRequested, onPauseRequested]);
    const onNextVideoButtonClick = useCallback(() => {
        if (nextVideo !== null && typeof onNextVideoRequested === 'function') {
            onNextVideoRequested();
        }
    }, [nextVideo, onNextVideoRequested]);
    const onMuteButtonClick = useCallback(() => {
        if (muted) {
            if (typeof onUnmuteRequested === 'function') {
                onUnmuteRequested();
            }
        } else {
            if (typeof onMuteRequested === 'function') {
                onMuteRequested();
            }
        }
    }, [muted, onMuteRequested, onUnmuteRequested]);
    const onChromecastButtonClick = useCallback(() => {
        chromecast.transport.requestSession();
    }, []);
    useEffect(() => {
        const onStateChanged = () => {
            setChromecastServiceActive(chromecast.active);
        };
        chromecast.on('stateChanged', onStateChanged);
        return () => {
            chromecast.off('stateChanged', onStateChanged);
        };
    }, []);

    const volumeIconName =
        (typeof muted === 'boolean' && muted) ? 'volume-mute' :
            (volume === null || isNaN(volume as number)) ? 'volume-off' :
                volume === 0 ? 'volume-mute' :
                    (volume as number) < 30 ? 'volume-low' :
                        (volume as number) < 70 ? 'volume-medium' :
                            'volume-high';

    return (
        <div
            ref={ref}
            {...props}
            onTouchStart={props.onMouseOver as unknown as React.TouchEventHandler}
            onTouchMove={props.onMouseMove as unknown as React.TouchEventHandler}
            onTouchEnd={onTouchEnd}
            className={cn('px-8 max-sm:px-0', className)}
        >
            <SeekBar
                className={'h-10 [--track-size:0.4rem] [--thumb-size:1.2rem] max-sm:mx-6'}
                time={time ?? null}
                duration={duration ?? null}
                buffered={buffered}
                onSeekRequested={onSeekRequested}
                playbackSpeed={playbackSpeed}
            />
            <div className={'flex flex-row items-center gap-1 max-sm:relative max-sm:gap-[0.15rem] max-sm:overflow-visible max-sm:px-2'}>
                <IconButton className={cn(CB_BUTTON, typeof paused !== 'boolean' && 'opacity-40')} title={paused ? t('PLAYER_PLAY') : t('PLAYER_PAUSE')} tabIndex={-1} onClick={onPlayPauseButtonClick}>
                    <Icon className={CB_ICON} name={typeof paused !== 'boolean' || paused ? 'play' : 'pause'} />
                </IconButton>
                {
                    nextVideo !== null ?
                        <IconButton className={CB_BUTTON} title={t('PLAYER_NEXT_VIDEO')} tabIndex={-1} onClick={onNextVideoButtonClick}>
                            <Icon className={CB_ICON} name={'next'} />
                        </IconButton>
                        :
                        null
                }
                <IconButton className={cn(CB_BUTTON, typeof muted !== 'boolean' && 'opacity-40')} title={muted ? t('PLAYER_UNMUTE') : t('PLAYER_MUTE')} tabIndex={-1} onClick={onMuteButtonClick}>
                    <Icon className={CB_ICON} name={volumeIconName} />
                </IconButton>
                {
                    !platform.isMobile ?
                        <VolumeSlider
                            className={'mx-2 h-16 flex-[0_1_10rem] [--thumb-size:1rem] [--track-size:0.35rem]'}
                            volume={volume ?? null}
                            muted={muted ?? undefined}
                            onVolumeChangeRequested={onVolumeChangeRequested}
                        />
                        : null
                }
                <div className={'flex-1'} />
                <IconButton className={cn(CB_BUTTON, 'hidden max-sm:flex')} onClick={toggleButtonsMenu}>
                    <Icon className={CB_ICON} name={'more-vertical'} />
                </IconButton>
                <div className={cn(
                    'flex flex-none flex-row gap-1',
                    'max-sm:absolute max-sm:bottom-[4.5rem] max-sm:right-0 max-sm:m-2 max-sm:max-w-[calc(100dvw-1rem)] max-sm:gap-[0.15rem] max-sm:overflow-x-auto max-sm:rounded-card max-sm:bg-(--modal-background-color) max-sm:p-2 max-sm:shadow-(--outer-glow)',
                    buttonsMenuOpen ? 'max-sm:flex' : 'max-sm:hidden',
                )}>
                    <IconButton className={cn(CB_BUTTON, !stream && 'opacity-40')} tabIndex={-1} onMouseDown={onStatisticsButtonMouseDown} onClick={onToggleStatisticsMenu}>
                        <Icon className={CB_ICON} name={'network'} />
                    </IconButton>
                    <IconButton className={cn(CB_BUTTON, playbackSpeed === null && 'opacity-40')} tabIndex={-1} onMouseDown={onSpeedButtonMouseDown} onClick={onToggleSpeedMenu}>
                        <Icon className={CB_ICON} name={'speed'} />
                    </IconButton>
                    <IconButton className={cn(CB_BUTTON, !chromecastServiceActive && 'opacity-40')} tabIndex={-1} onClick={onChromecastButtonClick}>
                        <Icon className={CB_ICON} name={'cast'} />
                    </IconButton>
                    <IconButton className={cn(CB_BUTTON, (!Array.isArray(subtitlesTracks) || subtitlesTracks.length === 0) && 'opacity-40')} tabIndex={-1} onMouseDown={onSubtitlesButtonMouseDown} onClick={onToggleSubtitlesMenu}>
                        <Icon className={CB_ICON} name={'subtitles'} />
                    </IconButton>
                    <IconButton className={cn(CB_BUTTON, (!Array.isArray(audioTracks) || audioTracks.length === 0) && 'opacity-40')} tabIndex={-1} onMouseDown={onAudioButtonMouseDown} onClick={onToggleAudioMenu}>
                        <Icon className={CB_ICON} name={'audio-tracks'} />
                    </IconButton>
                    {
                        (metaItem?.content?.videos?.length ?? 0) > 0 ?
                            <IconButton className={CB_BUTTON} tabIndex={-1} onMouseDown={onVideosButtonMouseDown} onClick={onToggleSideDrawer}>
                                <Icon className={CB_ICON} name={'episodes'} />
                            </IconButton>
                            :
                            null
                    }
                    <IconButton className={cn(CB_BUTTON, videoScale === null && 'opacity-40')} title={videoScaleLabel} tabIndex={-1} onClick={onVideoScaleChanged}>
                        <Icon className={CB_ICON} name={'scale'} />
                    </IconButton>
                    {
                        fullscreenSupported ?
                            <IconButton className={CB_BUTTON} title={fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')} tabIndex={-1} onClick={fullscreen ? exitFullscreen : requestFullscreen}>
                                <Icon className={CB_ICON} name={fullscreen ? 'minimize' : 'maximize'} />
                            </IconButton>
                            :
                            null
                    }
                    <IconButton className={cn(CB_BUTTON, !stream && 'opacity-40')} tabIndex={-1} onMouseDown={onOptionsButtonMouseDown} onClick={onToggleOptionsMenu}>
                        <Icon className={CB_ICON} name={'more-horizontal'} />
                    </IconButton>
                </div>
            </div>
        </div>
    );
});

export default ControlBar;
