// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useParams, useNavigate } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const debounce = require('lodash.debounce');
const langs = require('langs');
const { useTranslation } = require('react-i18next');
const { default: useRouteFocused } = require('rillio/common/useRouteFocused');
const { useCore } = require('rillio/core');
const { useServices, useGamepad } = require('rillio/services');
const { useContentGamepadNavigation } = require('rillio/services/GamepadNavigation');
const { useSettings, useProfile, useFullscreen, useBinaryState, useToast, useStreamingServer, withCoreSuspender, usePlatform, onShortcut, useDiscord, EMPTY_DISCORD_TIMESTAMPS, getPlaybackDiscordActivity } = require('rillio/common');
const { default: toPath } = require('rillio-router/toPath');
const { Presence, ContextMenu } = require('rillio/components');
const { default: TopBar } = require('./TopBar');
const { default: Buffering } = require('./Buffering');
const VolumeChangeIndicator = require('./VolumeChangeIndicator');
const Error = require('./Error');
const ControlBar = require('./ControlBar');
const NextVideoPopup = require('./NextVideoPopup');
const StatisticsMenu = require('./StatisticsMenu');
const OptionsMenu = require('./OptionsMenu');
const SubtitlesMenu = require('./SubtitlesMenu');
const { default: AudioMenu } = require('./AudioMenu');
const SpeedMenu = require('./SpeedMenu');
const { default: SideDrawerButton } = require('./SideDrawerButton');
const { default: SideDrawer } = require('./SideDrawer');
const usePlayer = require('./usePlayer');
const useStatistics = require('./useStatistics');
const useSlowDownload = require('./useSlowDownload');
const useNextEpisodePreload = require('./useNextEpisodePreload');
const NextEpisodePreloadPrompt = require('./NextEpisodePreloadPrompt');
const useVideo = require('./useVideo');
const { default: useSubtitles } = require('./useSubtitles');
const Video = require('./Video');
const { default: Indicator } = require('./Indicator/Indicator');
const { default: useMediaSession } = require('./useMediaSession');

// Player layer-stack classes, ported from the former Player/styles.less to Tailwind.
// The immersion opacity cascade and the active-slider grab cursor stay as global rules
// in styles/tailwind.css (they need html/body/ancestor selectors). Each chrome layer
// that fades under immersion carries the `player-immersion-fade` hook; the container
// toggles `data-immersed`, and `player-container` is the stable hook the global rule
// targets. Layers that reposition (nav / control / side-drawer / menu / indicator) are
// self-contained (no base inset-0) to avoid shorthand-vs-longhand ordering surprises.
const CONTAINER = 'player-container relative z-0 h-full w-full bg-black';
const LAYER = 'absolute inset-0 z-0';
const BACKGROUND_IMAGE = 'h-screen w-screen object-cover opacity-60';
const NAV_BAR_LAYER = "player-immersion-fade absolute left-(--safe-area-inset-left) right-(--safe-area-inset-right) top-0 z-0 overflow-visible before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-32 before:bg-gradient-to-b before:from-black/35 before:to-transparent before:content-['']";
const CONTROL_BAR_LAYER = "player-immersion-fade absolute bottom-0 left-(--safe-area-inset-left) right-(--safe-area-inset-right) z-0 overflow-visible pb-[calc(0.5rem+var(--safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-40 before:bg-gradient-to-t before:from-black/35 before:to-transparent before:content-['']";
const SIDE_DRAWER_BUTTON_LAYER = 'player-immersion-fade fixed left-auto right-[-4rem] top-1/2 z-0 -translate-y-1/2 [@media(max-width:1000px)]:right-[-2rem]';
const INDICATOR_LAYER = 'absolute bottom-40 left-0 right-0 z-0';
const MENU_LAYER = 'player-immersion-fade absolute bottom-[7.5rem] left-auto right-16 top-auto z-0 max-h-[calc(100%-13rem)] max-w-[calc(100%-4rem)] overflow-auto rounded-(--border-radius) bg-(--modal-background-color) shadow-(--outer-glow) backdrop-blur-[15px] [@media(orientation:portrait)_and_(max-width:640px)]:bottom-44 [@media(orientation:portrait)_and_(max-width:640px)]:right-10';

const findTrackByLang = (tracks, lang) => tracks.find((track) => track.lang === lang || langs.where('1', track.lang)?.[2] === lang);
const findTrackById = (tracks, id) => tracks.find((track) => track.id === id);

const GAMEPAD_HANDLER_ID = 'player';

const Player = () => {
    const { stream, streamTransportUrl, metaTransportUrl, type, id, videoId } = useParams();
    const urlParams = React.useMemo(() => ({
        stream,
        streamTransportUrl,
        metaTransportUrl,
        type,
        id,
        videoId
    }), [stream, streamTransportUrl, metaTransportUrl, type, id, videoId]);
    const [queryParams] = useSearchParams();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const services = useServices();
    const core = useCore();
    const gamepad = useGamepad();
    const forceTranscoding = React.useMemo(() => {
        return queryParams.has('forceTranscoding');
    }, [queryParams]);
    const profile = useProfile();
    const [player, videoParamsChanged, streamStateChanged, timeChanged, seek, pausedChanged, ended, nextVideo] = usePlayer(urlParams);
    const [settings] = useSettings();
    const streamingServer = useStreamingServer();
    const statistics = useStatistics(player, streamingServer);
    const video = useVideo();
    const routeFocused = useRouteFocused();
    const platform = usePlatform();
    const toast = useToast();
    const discord = useDiscord();
    const discordTimestamps = React.useRef(EMPTY_DISCORD_TIMESTAMPS);

    const [seeking, setSeeking] = React.useState(false);

    const [casting, setCasting] = React.useState(() => {
        return services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED;
    });
    const playbackDevices = React.useMemo(() => streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Ready' ? streamingServer.playbackDevices.content : [], [streamingServer]);

    const playerRef = React.useRef(null);
    const bufferingRef = React.useRef();
    const errorRef = React.useRef();

    const [immersed, setImmersed] = React.useState(true);
    const setImmersedDebounced = React.useCallback(debounce(setImmersed, 3000), []);
    const [fullscreen, , , toggleFullscreen, , setVideoElement] = useFullscreen();

    React.useEffect(() => {
        const el = video.containerRef.current?.querySelector('video');
        setVideoElement(el || null);
        return () => setVideoElement(null);
    }, [video.state.manifest]);

    const [optionsMenuOpen, , closeOptionsMenu, toggleOptionsMenu] = useBinaryState(false);
    const [subtitlesMenuOpen, , closeSubtitlesMenu, toggleSubtitlesMenu] = useBinaryState(false);
    const [audioMenuOpen, , closeAudioMenu, toggleAudioMenu] = useBinaryState(false);
    const [speedMenuOpen, , closeSpeedMenu, toggleSpeedMenu] = useBinaryState(false);
    const [statisticsMenuOpen, , closeStatisticsMenu, toggleStatisticsMenu] = useBinaryState(false);
    const [nextVideoPopupOpen, openNextVideoPopup, closeNextVideoPopup] = useBinaryState(false);
    const [sideDrawerOpen, , closeSideDrawer, toggleSideDrawer] = useBinaryState(false);

    const menusOpen = React.useMemo(() => {
        return optionsMenuOpen || subtitlesMenuOpen || audioMenuOpen || speedMenuOpen || statisticsMenuOpen || sideDrawerOpen || nextVideoPopupOpen;
    }, [optionsMenuOpen, subtitlesMenuOpen, audioMenuOpen, speedMenuOpen, statisticsMenuOpen, sideDrawerOpen, nextVideoPopupOpen]);

    const closeMenus = React.useCallback(() => {
        closeOptionsMenu();
        closeSubtitlesMenu();
        closeAudioMenu();
        closeSpeedMenu();
        closeStatisticsMenu();
        closeSideDrawer();
    }, []);

    // Raw streaming-server statistics content for the expandable stats section
    // (downloaded/uploaded/file size), beyond the peers/speed summary.
    const statisticsDetails = React.useMemo(() => {
        return streamingServer.statistics?.type === 'Ready' ? streamingServer.statistics.content : null;
    }, [streamingServer.statistics]);

    // Live streaming-server settings (the torrent profile lives here). Used by
    // the slow-download escalation to offer "Fast mode" via the EXISTING profile
    // mechanism, not a parallel flag.
    const streamingSettings = React.useMemo(() => {
        return streamingServer.settings?.type === 'Ready' ? streamingServer.settings.content : null;
    }, [streamingServer.settings]);

    // Sustained-slow detection + ephemeral speed test for the Initializing panel.
    const slowDownload = useSlowDownload({
        core,
        infoHash: statistics.infoHash,
        hasStatistics: statisticsDetails !== null,
        peers: statisticsDetails?.peers,
        speedBytesPerSec: statisticsDetails?.downloadSpeed,
        streamingSettings,
    });

    // Next-episode preload: prompt scheduling, per-series dismissal, the
    // /cache/download trigger, and the start-next-paused handoff after ended.
    const nextEpisodePreload = useNextEpisodePreload({ player, video });

    // "Try a different source": back to this title's streams list. The player
    // route carries the meta type/id and the video id, which is exactly the
    // MetaDetails streams route (/metadetails/:type/:id/:videoId).
    const onTryDifferentSource = React.useCallback(() => {
        const segments = [type, id, videoId]
            .filter((segment) => typeof segment === 'string' && segment.length > 0)
            .map((segment) => encodeURIComponent(segment));
        if (segments.length === 0) {
            navigate(-1);
            return;
        }
        navigate(`/metadetails/${segments.join('/')}`);
    }, [type, id, videoId, navigate]);

    const {
        streamSubtitles,
        allSubtitleTracks,
        extraSubtitleTracks,
        selectedExtraSubtitleTrackId,
        subtitlesMenuProps,
    } = useSubtitles({
        player,
        video,
        settings,
        streamStateChanged,
        menusOpen,
        closeMenus,
        closeSubtitlesMenu,
        toggleSubtitlesMenu,
    });

    const overlayHidden = React.useMemo(() => {
        return immersed && !casting && video.state.paused !== null && !video.state.paused && !menusOpen;
    }, [immersed, casting, video.state.paused, menusOpen]);

    const nextVideoPopupDismissed = React.useRef(false);
    const defaultAudioTrackSelected = React.useRef(false);
    const playingOnExternalDevice = React.useRef(false);
    const [error, setError] = React.useState(null);

    const VIDEO_SCALES = ['contain', 'cover', 'fill'];
    const VIDEO_SCALE_LABELS = { contain: t('PLAYER_SCALE_FIT'), cover: t('PLAYER_SCALE_CROP'), fill: t('PLAYER_SCALE_STRETCH') };

    const playbackSpeed = React.useRef(video.state.playbackSpeed || 1);
    const pressTimer = React.useRef(null);
    const longPress = React.useRef(false);
    // Intended paused state, so two fast clicks (a double-click) toggle
    // deterministically without racing React's re-render. See onVideoClick.
    const intendedPaused = React.useRef(null);
    // Timestamp of the previous video click, for custom double-click detection.
    // The native dblclick uses the ~500ms OS window, which feels far too long.
    const lastVideoClickTime = React.useRef(0);
    const controlBarRef = React.useRef(null);

    const HOLD_DELAY = 400;

    const handleNextVideoNavigation = React.useCallback((deepLinks, bingeWatching, ended) => {
        if (ended) {
            if (bingeWatching) {
                if (deepLinks.player) {
                    navigate(toPath(deepLinks.player), { replace: true });
                } else if (deepLinks.metaDetailsStreams) {
                    navigate(toPath(deepLinks.metaDetailsStreams), { replace: true });
                }
            } else {
                navigate(-1);
            }

        } else {
            if (deepLinks.player) {
                navigate(toPath(deepLinks.player), { replace: true });
            } else if (deepLinks.metaDetailsStreams) {
                navigate(toPath(deepLinks.metaDetailsStreams), { replace: true });
            }
        }
    }, []);

    const onEnded = React.useCallback(() => {
        ended();
        if (player.nextVideo !== null) {
            nextVideo();

            // An accepted preload means the user already chose to continue:
            // auto-continue even with binge watching off, and arm the handoff
            // that starts the next episode paused once it loads.
            if (nextEpisodePreload.accepted) {
                nextEpisodePreload.armPausedStart();
            }
            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching || nextEpisodePreload.accepted, true);
        } else {
            navigate(-1);
        }
    }, [player.nextVideo, profile.settings.bingeWatching, handleNextVideoNavigation, nextEpisodePreload.accepted, nextEpisodePreload.armPausedStart]);

    const onError = React.useCallback((error) => {
        console.error('Player', error);
        if (error.critical) {
            setError(error);
            // For a torrent stream the video layer only knows "loading failed";
            // the local engine knows WHY (disk full, torrent errored/paused
            // after a write failure, ...). Ask it and upgrade the message so
            // the user is not stuck staring at a generic error.
            const stream = player.selected !== null ? player.selected.stream : null;
            const serverUrl = profile.settings.streamingServerUrl;
            if (stream !== null && typeof stream.infoHash === 'string' && typeof serverUrl === 'string') {
                fetch(new URL(`${stream.infoHash}/stats.json`, serverUrl))
                    .then((resp) => resp.json())
                    .then((stats) => {
                        if (stats !== null && typeof stats.engineError === 'string' && stats.engineError.length > 0) {
                            // Disk full is user-fixable right here: deleting cached
                            // media frees the space, so point at the Cached page.
                            const diskFull = /not enough space|os error 112/i.test(stats.engineError);
                            setError((current) => current !== null ? {
                                ...current,
                                message: `${current.message}: ${stats.engineError}`,
                                freeSpace: diskFull,
                            } : current);
                        }
                    })
                    .catch(() => { /* the generic message stands */ });
            }
        } else {
            toast.show({
                type: 'error',
                title: t('ERROR'),
                message: error.message,
                timeout: 3000
            });
        }
    }, [player.selected, profile.settings.streamingServerUrl]);

    const onPlayRequested = React.useCallback(() => {
        playingOnExternalDevice.current = false;
        video.setPaused(false);
        setSeeking(false);
    }, []);

    const onPauseRequested = React.useCallback(() => {
        video.setPaused(true);
    }, []);

    const onMuteRequested = React.useCallback(() => {
        video.setMuted(true);
    }, []);

    const onUnmuteRequested = React.useCallback(() => {
        video.setMuted(false);
    }, []);

    const onVolumeChangeRequested = React.useCallback((volume) => {
        video.setVolume(volume);
    }, []);

    const onSeekRequested = React.useCallback((time) => {
        video.setTime(time);
        seek(time, video.state.duration, video.state.manifest?.name);
    }, [video.state.duration, video.state.manifest]);

    const onPlaybackSpeedChanged = React.useCallback((rate, skipUpdate) => {
        video.setPlaybackSpeed(rate);

        if (skipUpdate) return;

        playbackSpeed.current = rate;

    }, []);

    const onVideoScaleChanged = React.useCallback(() => {
        const currentScale = video.state.videoScale || 'contain';
        const currentIndex = VIDEO_SCALES.indexOf(currentScale);
        const nextScale = VIDEO_SCALES[(currentIndex + 1) % VIDEO_SCALES.length];
        video.setVideoScale(nextScale);
    }, [video.state.videoScale]);

    const onAudioTrackSelected = React.useCallback((id) => {
        video.setAudioTrack(id);
        streamStateChanged({
            audioTrack: {
                id,
            },
        });
    }, [streamStateChanged]);

    const onDismissNextVideoPopup = React.useCallback(() => {
        closeNextVideoPopup();
        nextVideoPopupDismissed.current = true;
    }, []);

    const onNextVideoRequested = React.useCallback(() => {
        if (player.nextVideo !== null) {
            nextVideo();

            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching, false);
        }
    }, [player.nextVideo, handleNextVideoNavigation, profile.settings]);

    // Keep the intent ref in sync when paused changes from anywhere else
    // (keyboard, ended, load, mpv).
    React.useEffect(() => {
        if (video.state.paused !== null) {
            intendedPaused.current = video.state.paused;
        }
    }, [video.state.paused]);

    const onVideoClick = React.useCallback(() => {
        if (video.state.paused === null || longPress.current) {
            return;
        }
        const DOUBLE_CLICK_MS = 200;
        const current = intendedPaused.current !== null ? intendedPaused.current : video.state.paused;
        const now = Date.now();
        if (now - lastVideoClickTime.current < DOUBLE_CLICK_MS) {
            // Second click inside the window -> double-click: undo the pause
            // toggle the first click just did, and go fullscreen instead. Custom
            // 200ms window because the native dblclick's ~500ms OS window is too
            // long for a player. Net result: play state unchanged + fullscreen.
            lastVideoClickTime.current = 0;
            const reverted = !current; // state before the first click
            intendedPaused.current = reverted;
            if (reverted) {
                onPauseRequested();
            } else {
                onPlayRequested();
            }
            toggleFullscreen();
            return;
        }
        lastVideoClickTime.current = now;
        // Single click: toggle immediately for instant feedback (no debounce).
        // Driven off the ref so two fast clicks can't race React's re-render.
        const nextPaused = !current;
        intendedPaused.current = nextPaused;
        if (nextPaused) {
            onPauseRequested();
        } else {
            onPlayRequested();
        }
    }, [video.state.paused, onPlayRequested, onPauseRequested, toggleFullscreen]);

    const onContainerMouseDown = React.useCallback((event) => {
        if (!event.nativeEvent.optionsMenuClosePrevented) {
            closeOptionsMenu();
        }
        if (!event.nativeEvent.subtitlesMenuClosePrevented) {
            closeSubtitlesMenu();
        }
        if (!event.nativeEvent.audioMenuClosePrevented) {
            closeAudioMenu();
        }
        if (!event.nativeEvent.speedMenuClosePrevented) {
            closeSpeedMenu();
        }
        if (!event.nativeEvent.statisticsMenuClosePrevented) {
            closeStatisticsMenu();
        }

        closeSideDrawer();
    }, []);

    const onContainerMouseMove = React.useCallback((event) => {
        setImmersed(false);
        if (!event.nativeEvent.immersePrevented) {
            setImmersedDebounced(true);
        } else {
            setImmersedDebounced.cancel();
        }
    }, []);

    const onContainerMouseLeave = React.useCallback(() => {
        setImmersedDebounced.cancel();
        setImmersed(true);
    }, []);

    const onBarMouseMove = React.useCallback((event) => {
        event.nativeEvent.immersePrevented = true;
    }, []);

    const onPlayPause = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.paused !== null) {
            if (video.state.paused) {
                onPlayRequested();
                setSeeking(false);
            } else {
                onPauseRequested();
            }
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.paused]);

    const onSeekPrev = React.useCallback((event) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            const seekTime = video.state.time - seekDuration;
            setSeeking(true);
            onSeekRequested(Math.max(seekTime, 0));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time]);

    const onSeekNext = React.useCallback((event) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time + seekDuration);
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time]);

    const onVolumeUp = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.min(video.state.volume + 5, 200));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onVolumeDown = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onGamepadSeekAndVol = React.useCallback((axis) => {
        switch(axis) {
            case 'left': {
                onSeekPrev();
                break;
            }
            case 'right': {
                onSeekNext();
                break;
            }
            case 'up': {
                onVolumeUp();
                break;
            }
            case 'down': {
                onVolumeDown();
                break;
            }
        }
    }, [onSeekPrev, onSeekNext, onVolumeUp, onVolumeDown]);

    useContentGamepadNavigation(playerRef, GAMEPAD_HANDLER_ID);

    React.useEffect(() => {
        gamepad?.on('buttonX', GAMEPAD_HANDLER_ID, onPlayPause);
        gamepad?.on('analogRight', GAMEPAD_HANDLER_ID, onGamepadSeekAndVol);

        return () => {
            gamepad?.off('buttonX', GAMEPAD_HANDLER_ID);
            gamepad?.off('analogRight', GAMEPAD_HANDLER_ID);
        };
    }, [onPlayPause, onGamepadSeekAndVol]);

    React.useEffect(() => {
        setError(null);
        video.unload();

        if (player.selected && player.stream?.type === 'Ready' && streamingServer.settings?.type !== 'Loading') {
            video.load({
                stream: {
                    ...player.stream.content,
                    subtitles: streamSubtitles
                },
                autoplay: true,
                time: player.libraryItem !== null &&
                    player.selected.streamRequest !== null &&
                    player.selected.streamRequest.path !== null &&
                    player.libraryItem.state.video_id === player.selected.streamRequest.path.id ?
                    player.libraryItem.state.timeOffset
                    :
                    0,
                forceTranscoding: forceTranscoding || casting,
                maxAudioChannels: settings.surroundSound ? 32 : 2,
                hardwareDecoding: settings.hardwareDecoding,
                assSubtitlesStyling: settings.assSubtitlesStyling,
                gpuVideoProcessing: settings.gpuVideoProcessing && platform.shell.capabilities.gpuVideoProcessing,
                videoMode: settings.videoMode,
                platform: platform.name,
                streamingServerURL: streamingServer.baseUrl ?
                    casting ?
                        streamingServer.baseUrl
                        :
                        streamingServer.selected.transportUrl
                    :
                    null,
                seriesInfo: player.seriesInfo,
            }, {
                chromecastTransport: services.chromecast.active ? services.chromecast.transport : null,
                shellTransport: platform.shell.active ? platform.shell : null,
            });
        }
    }, [streamingServer.baseUrl, player.selected, player.stream, streamSubtitles, forceTranscoding, casting]);

    React.useEffect(() => {
        !seeking && timeChanged(video.state.time, video.state.duration, video.state.manifest?.name);
    }, [video.state.time, video.state.duration, video.state.manifest, seeking]);

    React.useEffect(() => {
        if (playingOnExternalDevice.current && video.state.paused === false) {
            onPauseRequested();
        } else if (video.state.paused !== null) {
            pausedChanged(video.state.paused);
        }
    }, [video.state.paused]);

    React.useEffect(() => {
        videoParamsChanged(video.state.videoParams);
    }, [video.state.videoParams]);

    React.useEffect(() => {
        if (player.nextVideo !== null && !nextVideoPopupDismissed.current) {
            if (video.state.time !== null && video.state.duration !== null && video.state.time < video.state.duration && (video.state.duration - video.state.time) <= settings.nextVideoNotificationDuration) {
                openNextVideoPopup();
            } else {
                closeNextVideoPopup();
            }
        }
    }, [player.nextVideo, video.state.time, video.state.duration]);

    // Auto audio track selection
    React.useEffect(() => {
        if (!defaultAudioTrackSelected.current) {
            const savedTrackId = player.streamState?.audioTrack?.id;
            const savedTrack = savedTrackId ? findTrackById(video.state.audioTracks, savedTrackId) : null;
            const audioTrack = savedTrack ?? findTrackByLang(video.state.audioTracks, settings.audioLanguage);

            if (audioTrack && audioTrack.id) {
                video.setAudioTrack(audioTrack.id);
                defaultAudioTrackSelected.current = true;
            }
        }
    }, [video.state.audioTracks, player.streamState]);

    React.useEffect(() => {
        defaultAudioTrackSelected.current = false;
        nextVideoPopupDismissed.current = false;
        playingOnExternalDevice.current = false;
    }, [video.state.stream]);

    React.useEffect(() => {
        if (!Array.isArray(video.state.audioTracks) || video.state.audioTracks.length === 0) {
            closeAudioMenu();
        }
    }, [video.state.audioTracks]);

    React.useEffect(() => {
        if (video.state.playbackSpeed === null) {
            closeSpeedMenu();
        }
    }, [video.state.playbackSpeed]);

    React.useEffect(() => {
        const toastFilter = (item) => item?.dataset?.type === 'CoreEvent';
        toast.addFilter(toastFilter);
        const onCastStateChange = () => {
            setCasting(services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED);
        };
        const onChromecastServiceStateChange = () => {
            onCastStateChange();
            if (services.chromecast.active) {
                services.chromecast.transport.on(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
        const onCoreEvent = (name) => {
            if (name === 'PlayingOnDevice') {
                playingOnExternalDevice.current = true;
                onPauseRequested();
            }
        };
        services.chromecast.on('stateChanged', onChromecastServiceStateChange);
        core.on('event', onCoreEvent);
        onChromecastServiceStateChange();
        return () => {
            toast.removeFilter(toastFilter);
            services.chromecast.off('stateChanged', onChromecastServiceStateChange);
            core.off('event', onCoreEvent);
            if (services.chromecast.active) {
                services.chromecast.transport.off(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
    }, []);

    React.useEffect(() => {
        if (settings.pauseOnMinimize && (platform.shell.state.windowClosed || platform.shell.state.windowHidden)) {
            onPauseRequested();
        }
    }, [settings.pauseOnMinimize, platform.shell.state.windowClosed, platform.shell.state.windowHidden]);

    React.useEffect(() => {
        if (video.state.stream === null || typeof player?.title !== 'string') {
            discordTimestamps.current = EMPTY_DISCORD_TIMESTAMPS;
            discord.setActivity(null);
            return;
        }

        const metaItem = player.metaItem?.type === 'Ready' ? player.metaItem.content : null;
        const { activity, timestamps } = getPlaybackDiscordActivity({
            title: player.title,
            image: metaItem?.poster || metaItem?.background || null,
            paused: video.state.paused,
            time: video.state.time,
            duration: video.state.duration,
            timestamps: discordTimestamps.current,
        });

        discordTimestamps.current = timestamps;
        discord.setActivity(activity);
    }, [discord.setActivity, player?.title, player.metaItem, video.state.duration, video.state.paused, video.state.stream, video.state.time]);

    React.useEffect(() => {
        return () => {
            discord.setActivity(null);
        };
    }, [discord.setActivity]);

    useMediaSession(video.state, player, fullscreen, onPlayRequested, onPauseRequested, onNextVideoRequested);

    React.useEffect(() => {
        const onMediaKey = (action) => {
            switch (action) {
                case 'play-pause':
                    if (video.state.paused !== null) {
                        video.state.paused ? onPlayRequested() : onPauseRequested();
                    }
                    break;
                case 'play':
                    onPlayRequested();
                    break;
                case 'pause':
                    onPauseRequested();
                    break;
                case 'next-track':
                    if (player.nextVideo !== null) {
                        video.setTime(0);
                        onNextVideoRequested();
                    }
                    break;
            }
        };
        platform.shell.on('media-key', onMediaKey);
        return () => platform.shell.off('media-key', onMediaKey);
    }, [video.state.paused, player.nextVideo, onPlayRequested, onPauseRequested, onNextVideoRequested]);

    onShortcut('seekForward', (combo) => {
        if (video.state.time !== null) {
            const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time + seekDuration);
        }
    }, [video.state.time, onSeekRequested], !menusOpen);

    onShortcut('seekBackward', (combo) => {
        if (video.state.time !== null) {
            const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time - seekDuration);
        }
    }, [video.state.time, onSeekRequested], !menusOpen);

    onShortcut('mute', () => {
        video.state.muted === true ? onUnmuteRequested() : onMuteRequested();
    }, [video.state.muted], !menusOpen);

    onShortcut('volume', (combo) => {
        if (video.state.volume !== null) {
            const volume = combo === 0 ? Math.min(video.state.volume + 5, 200) : Math.max(video.state.volume - 5, 0);
            onVolumeChangeRequested(volume);
        }
    }, [video.state.volume], !menusOpen);

    onShortcut('audioMenu', () => {
        closeMenus();
        if (video.state?.audioTracks?.length > 0) {
            toggleAudioMenu();
        }
    }, [video.state.audioTracks, toggleAudioMenu]);

    onShortcut('infoMenu', () => {
        closeMenus();
        if (player.metaItem?.type === 'Ready') {
            toggleSideDrawer();
        }
    }, [player.metaItem, toggleSideDrawer]);

    onShortcut('speedMenu', () => {
        closeMenus();
        if (video.state.playbackSpeed !== null) {
            toggleSpeedMenu();
        }
    }, [video.state.playbackSpeed, toggleSpeedMenu]);

    onShortcut('speed', (combo) => {
        if (video.state.playbackSpeed !== null) {
            const speed = combo === 0 ? Math.max(video.state.playbackSpeed - 0.25, 0.25) : Math.min(video.state.playbackSpeed + 0.25, 2);
            onPlaybackSpeedChanged(speed);
        }
    }, [video.state.playbackSpeed, onPlaybackSpeedChanged], !menusOpen);

    onShortcut('statisticsMenu', () => {
        closeMenus();
        if (player.selected?.stream) {
            toggleStatisticsMenu();
        }
    }, [player.selected, toggleStatisticsMenu]);

    onShortcut('playNext', () => {
        closeMenus();
        if (player.nextVideo !== null) {
            nextVideo();
            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, false, false);
        }
    }, [player.nextVideo, handleNextVideoNavigation]);

    onShortcut('exit', () => {
        closeMenus();
        !settings.escExitFullscreen && navigate(-1);
    }, [settings.escExitFullscreen]);

    React.useLayoutEffect(() => {
        if (menusOpen) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
            longPress.current = false;
        }

        const onKeyDown = (e) => {
            if (e.code !== 'Space' || e.repeat) return;
            if (menusOpen || e.ctrlKey || e.metaKey || e.altKey) return;

            longPress.current = false;

            pressTimer.current = setTimeout(() => {
                longPress.current = true;
                onPlaybackSpeedChanged(2, true);
            }, HOLD_DELAY);
        };

        const onKeyUp = (e) => {
            if (e.code !== 'Space' && e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
                setSeeking(false);
                return;
            }
            if (e.code === 'Space') {
                clearTimeout(pressTimer.current);
                pressTimer.current = null;
                if (longPress.current) {
                    onPlaybackSpeedChanged(playbackSpeed.current);
                } else if (!menusOpen && video.state.paused !== null) {
                    if (video.state.paused) {
                        onPlayRequested();
                        setSeeking(false);
                    } else {
                        onPauseRequested();
                    }
                }
                longPress.current = false;
            }
        };

        const onWheel = ({ deltaY }) => {
            if (menusOpen || video.state.volume === null) return;

            if (deltaY > 0) {
                onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
            } else {
                if (video.state.volume < 100) {
                    onVolumeChangeRequested(Math.min(video.state.volume + 5, 100));
                }
            }
        };

        const onMouseDownHold = (e) => {
            if (e.button !== 0) return; // left mouse button only
            if (menusOpen) return;
            if (controlBarRef.current && controlBarRef.current.contains(e.target)) return;

            longPress.current = false;

            pressTimer.current = setTimeout(() => {
                longPress.current = true;
                onPlaybackSpeedChanged(2, true);
            }, HOLD_DELAY);
        };

        const onMouseUp = (e) => {
            if (e.button !== 0) return;

            clearTimeout(pressTimer.current);

            if (longPress.current) {
                onPlaybackSpeedChanged(playbackSpeed.current);
            }
        };

        const onBlur = () => {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
            if (longPress.current) {
                onPlaybackSpeedChanged(playbackSpeed.current);
                longPress.current = false;
            }
            setSeeking(false);
        };

        if (routeFocused) {
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('wheel', onWheel);
            window.addEventListener('mousedown', onMouseDownHold);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onBlur);
        }
        return () => {
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousedown', onMouseDownHold);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [routeFocused, menusOpen, video.state.volume, video.state.paused]);

    React.useEffect(() => {
        video.events.on('error', onError);
        video.events.on('ended', onEnded);

        return () => {
            video.events.off('error', onError);
            video.events.off('ended', onEnded);
        };
    }, [onEnded]);

    React.useLayoutEffect(() => {
        return () => {
            setImmersedDebounced.cancel();
        };
    }, []);

    return (
        <div ref={playerRef} className={CONTAINER} data-immersed={overlayHidden ? '' : undefined}
            onMouseDown={onContainerMouseDown}
            onMouseMove={onContainerMouseMove}
            onMouseOver={onContainerMouseMove}
            onMouseLeave={onContainerMouseLeave}>
            <Video
                ref={video.containerRef}
                className={LAYER}
                onClick={onVideoClick}
            />
            {
                !video.state.loaded ?
                    <div className={LAYER}>
                        <img className={BACKGROUND_IMAGE} src={player?.metaItem?.content?.background} />
                    </div>
                    :
                    null
            }
            {
                (video.state.buffering || !video.state.loaded) && !error ?
                    <Buffering
                        ref={bufferingRef}
                        className={LAYER}
                        logo={player?.metaItem?.content?.logo}
                        title={player?.selected?.stream?.name ?? null}
                        progress={statistics.progress}
                        infoHash={statistics.infoHash}
                        loaded={video.state.loaded}
                        hasStatistics={statisticsDetails !== null}
                        peers={statistics.peers}
                        speed={statistics.speed}
                        completed={statistics.completed}
                        escalated={slowDownload.escalated}
                        connectionSlow={slowDownload.connectionSlow}
                        fastModeAvailable={slowDownload.fastModeAvailable}
                        onTryDifferentSource={onTryDifferentSource}
                        onSwitchToFastMode={slowDownload.switchToFastMode}
                    />
                    :
                    null
            }
            {
                error !== null ?
                    <Error
                        ref={errorRef}
                        className={LAYER}
                        stream={video.state.stream}
                        onTryDifferentSource={onTryDifferentSource}
                        {...error}
                    />
                    :
                    null
            }
            {
                menusOpen ?
                    <div className={LAYER} />
                    :
                    null
            }
            {
                video.state.volume !== null && overlayHidden ?
                    <VolumeChangeIndicator
                        muted={video.state.muted}
                        volume={video.state.volume}
                    />
                    :
                    null
            }
            <ContextMenu on={[video.containerRef, bufferingRef, errorRef]} autoClose>
                <OptionsMenu
                    className={MENU_LAYER}
                    stream={player?.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                />
            </ContextMenu>
            <TopBar
                className={NAV_BAR_LAYER}
                title={player.title !== null ? player.title : ''}
                hdrInfo={video.state.hdrInfo}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
            />
            {
                player.metaItem?.type === 'Ready' ?
                    <SideDrawerButton
                        className={SIDE_DRAWER_BUTTON_LAYER}
                        onClick={toggleSideDrawer}
                    />
                    :
                    null
            }
            <ControlBar
                ref={controlBarRef}
                className={CONTROL_BAR_LAYER}
                paused={video.state.paused}
                time={video.state.time}
                duration={video.state.duration}
                buffered={video.state.buffered}
                volume={video.state.volume}
                muted={video.state.muted}
                playbackSpeed={video.state.playbackSpeed}
                subtitlesTracks={allSubtitleTracks}
                audioTracks={video.state.audioTracks}
                metaItem={player.metaItem}
                nextVideo={player.nextVideo}
                stream={player.selected !== null ? player.selected.stream : null}
                onPlayRequested={onPlayRequested}
                onPauseRequested={onPauseRequested}
                onNextVideoRequested={onNextVideoRequested}
                onMuteRequested={onMuteRequested}
                onUnmuteRequested={onUnmuteRequested}
                onVolumeChangeRequested={onVolumeChangeRequested}
                onSeekRequested={onSeekRequested}
                onToggleOptionsMenu={toggleOptionsMenu}
                onToggleSubtitlesMenu={toggleSubtitlesMenu}
                onToggleAudioMenu={toggleAudioMenu}
                onToggleSpeedMenu={toggleSpeedMenu}
                videoScale={video.state.videoScale}
                videoScaleLabel={VIDEO_SCALE_LABELS[video.state.videoScale || 'contain']}
                onVideoScaleChanged={onVideoScaleChanged}
                onToggleStatisticsMenu={toggleStatisticsMenu}
                onToggleSideDrawer={toggleSideDrawer}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
                onTouchEnd={onContainerMouseLeave}
            />
            <Indicator
                className={INDICATOR_LAYER}
                videoState={video.state}
                disabled={subtitlesMenuOpen}
            />
            {
                nextVideoPopupOpen ?
                    <NextVideoPopup
                        className={MENU_LAYER}
                        metaItem={player.metaItem !== null && player.metaItem.type === 'Ready' ? player.metaItem.content : null}
                        nextVideo={player.nextVideo}
                        onDismiss={onDismissNextVideoPopup}
                        onNextVideoRequested={onNextVideoRequested}
                    />
                    :
                    null
            }
            {
                nextEpisodePreload.promptVisible && !menusOpen && error === null ?
                    <NextEpisodePreloadPrompt
                        onAccept={nextEpisodePreload.accept}
                        onDismiss={nextEpisodePreload.dismiss}
                        onMouseMove={onBarMouseMove}
                        onMouseOver={onBarMouseMove}
                    />
                    :
                    null
            }
            <Presence when={statisticsMenuOpen}>
                <StatisticsMenu
                    className={MENU_LAYER}
                    {...statistics}
                    details={statisticsDetails}
                />
            </Presence>
            {
                player.metaItem?.type === 'Ready' ?
                    <SideDrawer
                        open={sideDrawerOpen}
                        onClose={closeSideDrawer}
                        metaItem={player.metaItem?.content}
                        seriesInfo={player.seriesInfo}
                        selected={player.selected?.streamRequest?.path?.id}
                    />
                    :
                    null
            }
            <Presence when={subtitlesMenuOpen}>
                <SubtitlesMenu
                    className={MENU_LAYER}
                    {...subtitlesMenuProps}
                />
            </Presence>
            <Presence when={audioMenuOpen}>
                <AudioMenu
                    className={MENU_LAYER}
                    audioTracks={video.state.audioTracks}
                    selectedAudioTrackId={video.state.selectedAudioTrackId}
                    onAudioTrackSelected={onAudioTrackSelected}
                />
            </Presence>
            <Presence when={speedMenuOpen}>
                <SpeedMenu
                    className={MENU_LAYER}
                    playbackSpeed={video.state.playbackSpeed}
                    onPlaybackSpeedChanged={onPlaybackSpeedChanged}
                />
            </Presence>
            <Presence when={optionsMenuOpen}>
                <OptionsMenu
                    className={MENU_LAYER}
                    stream={player.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                />
            </Presence>
        </div>
    );
};

const PlayerFallback = () => (
    <div className={CONTAINER} />
);

module.exports = withCoreSuspender(Player, PlayerFallback);
