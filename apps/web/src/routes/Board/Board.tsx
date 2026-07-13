// Copyright (C) 2017-2023 Smart code 203358507

/**
 * Board - the home route. Clean-room rewrite (Phase 3 / Wave B): the shell, hero and
 * row orchestration are authored here in TypeScript on Tailwind utilities over our
 * semantic tokens; it consumes the already-rewritten kit-based MetaRow / MetaItem /
 * ContinueWatchingItem verbatim. Every hook and the windowing contract are reused
 * exactly as before: useBoard's loadBoardRows({start,end}) lazy loading, the hero
 * fed from the first Ready catalog, the boardCatalogsOffset that accounts for the
 * hero + continue-watching rows shifting the visible-child -> catalog index map, the
 * THRESHOLD=5 debounced scroll re-run, and the streaming-server warning gating.
 *
 * The one thing NOT expressed in Tailwind is the per-breakpoint poster trim: it
 * targets MetaRow's hashed `.meta-item` class, so it stays in styles.less (see the
 * note there). Board pins the row-shape marker classes from that module on each row.
 */

import React from 'react';
import debounce from 'lodash.debounce';
import useTranslate from 'rillio/common/useTranslate';
import { useStreamingServer, useNotifications, withCoreSuspender, getVisibleChildrenRange, useProfile } from 'rillio/common';
import { ContinueWatchingItem, EventModal, MainNavBars, MetaItem, MetaRow } from 'rillio/components';
import useBoard from './useBoard';
import useContinueWatchingPreview from './useContinueWatchingPreview';
import StreamingServerWarning from './StreamingServerWarning';
import HeroCarousel from './HeroCarousel';
import styles from './styles.less';

const HERO_SLIDES = 6;

const THRESHOLD = 5;

// Row rhythm: 1rem top / 2rem bottom, tightened to 1.5rem bottom at the minimum
// width. Kept as a shared string so every row (catalog, continue-watching,
// placeholder, error) matches exactly.
const ROW_SPACING = 'mt-4 mb-8 max-[640px]:mb-6';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

const Board = () => {
    const t = useTranslate();
    const streamingServer = useStreamingServer();
    const continueWatchingPreview = useContinueWatchingPreview();
    const [board, loadBoardRows] = useBoard();
    const notifications = useNotifications();
    const profile = useProfile();
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const showStreamingServerWarning = React.useMemo(() => {
        return streamingServer.settings !== null && streamingServer.settings.type === 'Err' && (
            isNaN(profile.settings.streamingServerWarningDismissed.getTime()) ||
            profile.settings.streamingServerWarningDismissed.getTime() < Date.now());
    }, [profile.settings, streamingServer.settings]);
    // Feed the hero from the first catalog that has loaded (Cinemeta's Popular
    // /Top row), so it costs no extra fetch. Only items with a backdrop qualify.
    const heroItems = React.useMemo(() => {
        const catalog = board.catalogs.find((catalog: any) => (
            catalog.content?.type === 'Ready' &&
            Array.isArray(catalog.content.content) &&
            catalog.content.content.length > 0
        ));
        if (!catalog) {
            return [];
        }

        return catalog.content.content
            .filter((item: any) => typeof item.background === 'string' && item.background.length > 0)
            .slice(0, HERO_SLIDES);
    }, [board.catalogs]);
    // The hero and the continue-watching row precede the catalog rows inside the
    // scroll container, so they shift the visible-child -> catalog index mapping.
    const boardCatalogsOffset = (continueWatchingPreview.items.length > 0 ? 1 : 0) + (heroItems.length > 0 ? 1 : 0);
    const onVisibleRangeChange = React.useCallback(() => {
        const range = getVisibleChildrenRange(scrollContainerRef.current);
        if (range === null) {
            return;
        }

        const start = Math.max(0, range.start - boardCatalogsOffset - THRESHOLD);
        const end = range.end - boardCatalogsOffset + THRESHOLD;
        if (end < start) {
            return;
        }

        loadBoardRows({ start, end });
    }, [boardCatalogsOffset]);
    const onScroll = React.useCallback(debounce(onVisibleRangeChange, 250), [onVisibleRangeChange]);
    React.useLayoutEffect(() => {
        onVisibleRangeChange();
    }, [board.catalogs, onVisibleRangeChange]);
    return (
        <div className="flex h-[calc(100%-var(--safe-area-inset-bottom))] w-full flex-col max-[640px]:relative max-[640px]:z-0">
            <EventModal />
            <MainNavBars className="flex-1 self-stretch bg-transparent" route={'board'}>
                <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto px-4" onScroll={onScroll}>
                    {
                        heroItems.length > 0 ?
                            <HeroCarousel className={cx('mt-2 mb-8', 'animation-fade-in')} items={heroItems} />
                            :
                            null
                    }
                    {
                        continueWatchingPreview.items.length > 0 ?
                            <MetaRow
                                className={cx(ROW_SPACING, styles['continue-watching-row'], 'animation-fade-in')}
                                title={t.string('BOARD_CONTINUE_WATCHING')}
                                catalog={continueWatchingPreview}
                                itemComponent={ContinueWatchingItem}
                                notifications={notifications}
                            />
                            :
                            null
                    }
                    {board.catalogs.map((catalog: any, index: number) => {
                        switch (catalog.content?.type) {
                            case 'Ready': {
                                return (
                                    <MetaRow
                                        key={index}
                                        className={cx(ROW_SPACING, styles[`row-${catalog.content.content[0].posterShape}`], 'animation-fade-in')}
                                        catalog={catalog}
                                        itemComponent={MetaItem}
                                    />
                                );
                            }
                            case 'Err': {
                                if (catalog.content.content !== 'EmptyContent') {
                                    return (
                                        <MetaRow
                                            key={index}
                                            className={cx(ROW_SPACING, 'animation-fade-in')}
                                            catalog={catalog}
                                            message={catalog.content.content}
                                        />
                                    );
                                }
                                return null;
                            }
                            default: {
                                return (
                                    <MetaRow.Placeholder
                                        key={index}
                                        className={cx(ROW_SPACING, styles['row-poster'], 'animation-fade-in')}
                                        catalog={catalog}
                                        title={t.catalogTitle(catalog)}
                                    />
                                );
                            }
                        }
                    })}
                </div>
            </MainNavBars>
            {
                showStreamingServerWarning ?
                    <StreamingServerWarning className={styles['board-warning-container']} />
                    :
                    null
            }
        </div>
    );
};

const BoardFallback = () => (
    <div className="flex h-[calc(100%-var(--safe-area-inset-bottom))] w-full flex-col">
        <MainNavBars className="flex-1 self-stretch bg-transparent" route={'board'} />
    </div>
);

export default withCoreSuspender(Board, BoardFallback);
