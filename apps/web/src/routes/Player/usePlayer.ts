// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import { useModelState, useCoreSuspender } from 'rillio/common';

// The player model as it is actually consumed here: the global Player type is
// augmented with the raw model fields the UI reads that are not on it (`stream`),
// and the deep, dynamic shapes (metaItem content, the core-injected next-video
// `streams`) are loosened so the semantics-preserving access patterns type-check.
type PlayerModel = Omit<Player, 'metaItem' | 'nextVideo'> & {
    metaItem: Loadable<any> | null;
    nextVideo: (VideoPlayer & { streams?: Stream[] }) | null;
    stream: Loadable<any> | null;
};

// Boundary type for the (untyped-JS) CoreSuspender context value.
type CoreSuspenderApi = {
    getState: (model: string) => any;
    decodeStream: (stream?: string) => Stream | null;
};

type PlayerUrlParams = {
    stream?: string;
    streamTransportUrl?: string;
    metaTransportUrl?: string;
    type?: string;
    id?: string;
    videoId?: string;
};

type UsePlayerResult = [
    PlayerModel,
    (videoParams: any) => void,
    (partialStreamState: Partial<StreamState>) => Promise<void>,
    (time: number | null, duration: number | null, device?: string) => void,
    (time: number | null, duration: number | null, device?: string) => void,
    (paused: boolean) => void,
    () => void,
    () => void,
];

const map = (player: any): PlayerModel => ({
    ...player,
    metaItem: player.metaItem !== null && player.metaItem.type === 'Ready' ?
        {
            ...player.metaItem,
            content: {
                ...player.metaItem.content,
                released: new Date(
                    typeof player.metaItem.content.released === 'string' ?
                        player.metaItem.content.released
                        :
                        NaN
                ),
                videos: player.metaItem.content.videos.map((video: any) => ({
                    ...video,
                    released: new Date(
                        typeof video.released === 'string' ?
                            video.released
                            :
                            NaN
                    ),
                }))
            }
        }
        :
        player.metaItem,
});

const usePlayer = (urlParams: PlayerUrlParams): UsePlayerResult => {
    const core = useCore();
    const { decodeStream } = useCoreSuspender() as unknown as CoreSuspenderApi;
    const stream = decodeStream(urlParams.stream);
    const action = React.useMemo(() => {
        if (stream !== null) {
            return {
                action: 'Load',
                args: {
                    model: 'Player',
                    args: {
                        stream,
                        streamRequest: typeof urlParams.streamTransportUrl === 'string' && typeof urlParams.type === 'string' && typeof urlParams.videoId === 'string' ?
                            {
                                base: urlParams.streamTransportUrl,
                                path: {
                                    resource: 'stream',
                                    type: urlParams.type,
                                    id: urlParams.videoId,
                                    extra: []
                                }
                            }
                            :
                            null,
                        metaRequest: typeof urlParams.metaTransportUrl === 'string' && typeof urlParams.type === 'string' && typeof urlParams.id === 'string' ?
                            {
                                base: urlParams.metaTransportUrl,
                                path: {
                                    resource: 'meta',
                                    type: urlParams.type,
                                    id: urlParams.id,
                                    extra: []
                                }
                            }
                            :
                            null,
                        subtitlesPath: typeof urlParams.type === 'string' && typeof urlParams.videoId === 'string' ?
                            {
                                resource: 'subtitles',
                                type: urlParams.type,
                                id: urlParams.videoId,
                                extra: []
                            }
                            :
                            null
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [urlParams]);

    const player = useModelState({ model: 'player', action, map }) as PlayerModel;

    const videoParamsChanged = React.useCallback((videoParams: any) => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'VideoParamsChanged',
                args: { videoParams }
            }
        }, 'player');
    }, []);
    const timeChanged = React.useCallback((time: number | null, duration: number | null, device?: string) => {
        if (typeof time === 'number' && typeof duration === 'number' && typeof device === 'string') {
            core.transport.dispatch({
                action: 'Player',
                args: {
                    action: 'TimeChanged',
                    args: {
                        time: Math.max(0, Math.round(time)),
                        duration: Math.max(0, Math.round(duration)),
                        device,
                    }
                }
            }, 'player');
        }
    }, []);

    const seek = React.useCallback((time: number | null, duration: number | null, device?: string) => {
        if (typeof time === 'number' && typeof duration === 'number' && typeof device === 'string') {
            core.transport.dispatch({
                action: 'Player',
                args: {
                    action: 'Seek',
                    args: {
                        time: Math.max(0, Math.round(time)),
                        duration: Math.max(0, Math.round(duration)),
                        device,
                    }
                }
            }, 'player');
        }
    }, []);

    const ended = React.useCallback(() => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'Ended'
            }
        }, 'player');
    }, []);
    const pausedChanged = React.useCallback((paused: boolean) => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'PausedChanged',
                args: { paused }
            }
        }, 'player');
    }, []);
    const nextVideo = React.useCallback(() => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'NextVideo'
            }
        }, 'player');
    }, []);

    const streamStateChanged = React.useCallback((partialStreamState: Partial<StreamState>) => {
        return core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'StreamStateChanged',
                args: {
                    state: {
                        ...player.streamState,
                        ...partialStreamState,
                    },
                },
            },
        }, 'player');
    }, [player.streamState]);

    return [player, videoParamsChanged, streamStateChanged, timeChanged, seek, pausedChanged, ended, nextVideo];
};

export default usePlayer;
