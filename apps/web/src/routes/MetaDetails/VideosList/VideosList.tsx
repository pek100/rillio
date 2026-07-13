// Copyright (C) 2017-2023 Smart code 203358507

/**
 * VideosList (Phase 3 clean-room rewrite) - the series episode view.
 *
 * View rebuilt on Tailwind tokens + the kit Switch (notifications); the responsive
 * auto-fill episode grid stays native CSS. All logic reused verbatim: the videos /
 * seasons / selectedSeason / videosForSeason / seasonWatched memos, the
 * savedScrollTop restore (useLayoutEffect) + season-change scroll effect, and the
 * MarkVideoAsWatched / MarkSeasonAsWatched dispatches. The Video card is a shared
 * component (its own family), consumed unchanged.
 */

import React from 'react';
import { t } from 'i18next';
import { useCore } from 'rillio/core';
import { Image, Video } from 'rillio/components';
import { Switch } from 'rillio/components/ui/switch';
import { cn } from 'rillio/components/ui/cn';
import SeasonsBar from './SeasonsBar';
import EpisodePicker from '../EpisodePicker';

const emptyImage = require('/assets/images/empty.svg');

let savedScrollTop = 0;

type Props = {
    className?: string;
    metaItem?: any;
    libraryItem?: any;
    season?: number;
    selectedVideoId?: string;
    seasonOnSelect?: (event: any) => void;
    toggleNotifications?: () => void;
};

const VideosList = ({ className, metaItem, libraryItem, season, seasonOnSelect, selectedVideoId, toggleNotifications }: Props) => {
    const core = useCore();
    const showNotificationsToggle = React.useMemo(() => {
        return metaItem?.content?.content?.inLibrary && metaItem?.content?.content?.videos?.length;
    }, [metaItem]);
    const videos = React.useMemo(() => {
        return metaItem && metaItem.content.type === 'Ready' ?
            metaItem.content.content.videos
            :
            [];
    }, [metaItem]);
    const seasons = React.useMemo(() => {
        return videos
            .map(({ season }) => season)
            .filter((season, index, seasons) => {
                return season !== null &&
                    !isNaN(season) &&
                    typeof season === 'number' &&
                    seasons.indexOf(season) === index;
            })
            .sort((a, b) => (a || Number.MAX_SAFE_INTEGER) - (b || Number.MAX_SAFE_INTEGER));
    }, [videos]);
    const selectedSeason = React.useMemo(() => {
        if (seasons.includes(season)) {
            return season;
        }

        const video = videos?.find((video) => video.id === libraryItem?.state.video_id);

        if (video && video.season && seasons.includes(video.season)) {
            return video.season;
        }

        const nonSpecialSeasons = seasons.filter((season) => season !== 0);
        if (nonSpecialSeasons.length > 0) {
            return nonSpecialSeasons[0];
        }

        if (seasons.length > 0) {
            return seasons[0];
        }

        return null;
    }, [seasons, season, videos, libraryItem]);
    const videosForSeason = React.useMemo(() => {
        return videos
            .filter((video) => {
                return selectedSeason === null || video.season === selectedSeason;
            })
            .sort((a, b) => {
                return a.episode - b.episode;
            });
    }, [videos, selectedSeason]);

    const seasonWatched = React.useMemo(() => {
        return videosForSeason.every((video) => video.watched);
    }, [videosForSeason]);

    const videosContainerRef = React.useRef<HTMLDivElement>(null);
    const isMountedRef = React.useRef(false);

    const saveScrollPosition = React.useCallback(() => {
        savedScrollTop = videosContainerRef.current?.scrollTop ?? 0;
    }, []);

    // Restore scroll on mount (before paint), consume immediately
    React.useLayoutEffect(() => {
        if (savedScrollTop > 0 && videosContainerRef.current) {
            videosContainerRef.current.scrollTop = savedScrollTop;
            savedScrollTop = 0;
        }
    }, []);

    // Scroll to top when the season changes (skip on initial mount to respect restored scroll position)
    React.useEffect(() => {
        if (!isMountedRef.current) {
            isMountedRef.current = true;
            return;
        }
        const hasSelectedVideo = videosForSeason.some((v) => v.id === selectedVideoId);
        if (!hasSelectedVideo && videosContainerRef.current) {
            videosContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [selectedSeason]);

    const onMarkVideoAsWatched = (video, watched) => {
        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkVideoAsWatched',
                args: [video, !watched]
            }
        });
    };

    const onMarkSeasonAsWatched = (season, watched) => {
        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkSeasonAsWatched',
                args: [season, !watched]
            }
        });
    };

    const onSeasonSearch = (value) => {
        if (value) {
            seasonOnSelect?.({
                type: 'select',
                value,
            });
        }
    };

    return (
        <div className={cn('flex flex-col', className)}>
            {
                !metaItem || metaItem.content.type === 'Loading' ?
                    <React.Fragment>
                        <SeasonsBar.Placeholder className="mx-4 mb-4 mt-2 flex-none self-stretch" />
                        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] content-start gap-x-4 gap-y-2 self-stretch overflow-y-auto px-4">
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                        </div>
                    </React.Fragment>
                    :
                    metaItem.content.type === 'Err' || videosForSeason.length === 0 ?
                        <div className="flex flex-1 flex-col items-center self-stretch overflow-y-auto p-8">
                            <EpisodePicker className="mb-8" onSubmit={onSeasonSearch} />
                            <Image className="mb-4 h-40 w-40 max-w-full flex-none object-contain object-center opacity-90" src={emptyImage} alt={' '} />
                            <div className="flex-none text-center text-[1.4rem] text-fg">{t('ERR_NO_VIDEOS_FOR_META')}</div>
                        </div>
                        :
                        <React.Fragment>
                            {
                                showNotificationsToggle && libraryItem ?
                                    <label className="flex flex-none items-center justify-start gap-4 px-6 pb-[0.65rem] pt-[1.15rem] text-fg">
                                        <Switch checked={!libraryItem.state.noNotif} onCheckedChange={() => toggleNotifications?.()} />
                                        <span>{t('DETAIL_RECEIVE_NOTIF_SERIES')}</span>
                                    </label>
                                    :
                                    null
                            }
                            {
                                seasons.length > 0 ?
                                    <SeasonsBar
                                        className="mx-4 mb-4 mt-2 flex-none self-stretch"
                                        season={selectedSeason}
                                        seasons={seasons}
                                        onSelect={seasonOnSelect}
                                    />
                                    :
                                    null
                            }
                            <div ref={videosContainerRef} className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] content-start gap-x-4 gap-y-2 self-stretch overflow-y-auto px-4">
                                {
                                    videosForSeason.map((video, index) => (
                                        <Video
                                            key={index}
                                            id={video.id}
                                            title={video.title}
                                            thumbnail={video.thumbnail}
                                            season={video.season}
                                            episode={video.episode}
                                            released={video.released}
                                            upcoming={video.upcoming}
                                            watched={video.watched}
                                            progress={video.progress}
                                            deepLinks={video.deepLinks}
                                            scheduled={video.scheduled}
                                            seasonWatched={seasonWatched}
                                            selected={video.id === selectedVideoId}
                                            onSelect={saveScrollPosition}
                                            onMarkVideoAsWatched={onMarkVideoAsWatched}
                                            onMarkSeasonAsWatched={onMarkSeasonAsWatched}
                                        />
                                    ))
                                }
                            </div>
                        </React.Fragment>
            }
        </div>
    );
};

export default VideosList;
