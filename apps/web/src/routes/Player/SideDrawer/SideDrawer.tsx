// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player side drawer (chapters / episodes). Rebuilt on the kit Sheet with
 * modal={false} and overlay disabled (decisions.md #6): NO scrim and NO focus trap,
 * so the playing video underneath stays fully interactive - exactly like the old
 * custom transform drawer. Right-edge, full height, square corners.
 *
 * Radix's own dismiss paths are disabled (onInteractOutside / onEscapeKeyDown /
 * onOpenAutoFocus preventDefault) so the Player keeps ownership of close + focus,
 * preserving the pre-existing behavior: outside-click closes via the Player container
 * mousedown, and Escape is governed by the Player's `exit` shortcut. The
 * MarkVideoAsWatched / MarkSeasonAsWatched dispatches and the selected-video focus
 * handoff (now on animationEnd) are preserved.
 */

import React, { forwardRef, memo, useCallback, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useCore } from 'rillio/core';
import { CONSTANTS } from 'rillio/common';
import { MetaPreview, Video } from 'rillio/components';
import SeasonsBar from 'rillio/routes/MetaDetails/VideosList/SeasonsBar';
import { Sheet, SheetContent, SheetTitle } from 'rillio/components/ui';
import SnapshotBackdrop from '../SnapshotBackdrop';

type Props = {
    open: boolean;
    onClose: () => void;
    seriesInfo: SeriesInfo;
    metaItem: MetaItem;
    selected: string;
};

const SideDrawer = memo(forwardRef<HTMLDivElement, Props>(function SideDrawer({ open, onClose, seriesInfo, selected, ...props }, ref) {
    const core = useCore();
    const [season, setSeason] = useState<number>(seriesInfo?.season);
    const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
    const videosRef = useRef<HTMLDivElement>(null);

    const metaItem = useMemo(() => {
        return seriesInfo ?
            {
                ...props.metaItem,
                links: props.metaItem.links.filter(({ category }) => category === CONSTANTS.SHARE_LINK_CATEGORY),
            }
            :
            props.metaItem;
    }, [props.metaItem]);
    const videos = useMemo(() => {
        return Array.isArray(metaItem.videos) ?
            metaItem.videos.filter((video) => video.season === season)
            :
            metaItem.videos;
    }, [metaItem, season]);
    const seasons = useMemo(() => {
        return props.metaItem.videos
            .map(({ season }) => season)
            .filter((season, index, seasons) => {
                return seasons.indexOf(season) === index;
            })
            .sort((a, b) => (a || Number.MAX_SAFE_INTEGER) - (b || Number.MAX_SAFE_INTEGER));
    }, [props.metaItem.videos]);

    const seasonOnSelect = useCallback((event: { value: string | number }) => {
        setSeason(parseInt(String(event.value), 10));
        videosRef.current?.scrollTo({ top: 0, left: 0 });
    }, []);

    const seasonWatched = useMemo(() => {
        return videos.every((video) => video.watched);
    }, [videos]);

    const onMarkVideoAsWatched = useCallback((video: Video, watched: boolean) => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'MarkVideoAsWatched',
                args: [video, !watched],
            },
        });
    }, []);

    const onMarkSeasonAsWatched = (season: number, watched: boolean) => {
        core.transport.dispatch({
            action: 'Player',
            args: {
                action: 'MarkSeasonAsWatched',
                args: [season, !watched],
            },
        });
    };

    const onMouseDown = (event: React.MouseEvent) => {
        event.stopPropagation();
    };

    // The old transform drawer set the selected-video highlight once its slide
    // finished (transitionEnd); the Sheet slides via a keyframe animation, so the
    // handoff moves to animationEnd.
    const onAnimationEnd = useCallback(() => {
        setSelectedVideoId(selected);
    }, [selected]);

    return (
        <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} modal={false}>
            <SheetContent
                ref={ref}
                side={'right'}
                overlay={false}
                showClose={false}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                onMouseDown={onMouseDown}
                onAnimationEnd={onAnimationEnd}
                aria-describedby={undefined}
                // Layout only: SheetContent already carries the house glass material
                // (bg-card + border-line + shadow-elevated + the glass blur token).
                className={'z-[1] w-full max-w-[35rem] gap-0 overflow-y-auto p-4 pt-[calc(1rem+var(--safe-area-inset-top))] max-sm:max-w-full'}
            >
                <SnapshotBackdrop />
                <SheetTitle className={'sr-only'}>{metaItem.name}</SheetTitle>
                <div
                    className={'absolute right-[1.3rem] top-[calc(1.3rem+var(--safe-area-inset-top))] z-[2] hidden cursor-pointer rounded-card p-2 hover:bg-(--overlay-color) max-sm:block'}
                    onClick={onClose}
                >
                    <ChevronRight className={'size-8 text-fg opacity-60 transition-opacity hover:opacity-100'} />
                </div>
                <div className={'min-h-0 overflow-y-auto p-4'}>
                    <MetaPreview
                        compact={true}
                        name={metaItem.name}
                        logo={metaItem.logo}
                        runtime={metaItem.runtime}
                        releaseInfo={metaItem.releaseInfo}
                        released={metaItem.released}
                        description={metaItem.description}
                        links={metaItem.links}
                    />
                </div>
                {
                    seriesInfo ?
                        <div className={'flex min-h-0 flex-[2] flex-col'}>
                            <SeasonsBar
                                season={season}
                                seasons={seasons}
                                onSelect={seasonOnSelect}
                            />
                            <div ref={videosRef} className={'min-h-0 flex-1 overflow-y-auto'}>
                                {videos.map((video, index) => (
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
                                        seasonWatched={seasonWatched}
                                        progress={video.progress}
                                        deepLinks={video.deepLinks}
                                        scheduled={video.scheduled}
                                        selected={video.id === selectedVideoId}
                                        onMarkVideoAsWatched={onMarkVideoAsWatched}
                                        onMarkSeasonAsWatched={onMarkSeasonAsWatched}
                                    />
                                ))}
                            </div>
                        </div>
                        : null
                }
            </SheetContent>
        </Sheet>
    );
}));

export default SideDrawer;
