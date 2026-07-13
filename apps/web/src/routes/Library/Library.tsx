// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Library route - clean-room Tailwind rewrite on the foundation kit.
 *
 * Same rendered layout and states as the legacy Library.js: a type filter + sort
 * control bar over a responsive poster grid, with a not-loaded (delayed) and an empty
 * message state. Every hook, deep-link builder and core interaction is reused verbatim
 * (useLibrary / useSelectableInputs / useOnScrollToBottom / withModel / withCoreSuspender);
 * only the view layer changed:
 *   - the legacy MultiselectMenu type filter -> kit Select (portaled, accent-dot rows),
 *   - the legacy Chips sort control -> kit ToggleGroup (single) with a `motion` layoutId
 *     active pill that slides between sort options,
 *   - the .less grid / message layout -> Tailwind utilities on our semantic tokens.
 *
 * The selectable-inputs contract is unchanged: typeSelect = { options, value, onSelect }
 * and sortChips = { options, selected[], onSelect }, both navigating via toPath(deepLink)
 * so the active state stays URL-derived (never internal trigger state).
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useNavigate } from 'react-router';
import { useSearchParams } from 'react-router-dom';
import { m } from 'motion/react';
import { LazyMotionProvider, pillHover } from 'rillio/components/ui/motion';
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from 'rillio/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from 'rillio/components/ui/toggle-group';
import HorizontalScroll from 'rillio/components/HorizontalScroll';

const NotFound = require('rillio/routes/NotFound');
const { useProfile, useNotifications, useOnScrollToBottom, withCoreSuspender } = require('rillio/common');
const toPath = require('rillio-router/toPath').default;
const { DelayedRenderer, Image, MainNavBars, LibItem } = require('rillio/components');
const useLibrary = require('./useLibrary');
const useSelectableInputs = require('./useSelectableInputs');

const SCROLL_TO_BOTTOM_TRESHOLD = 400;

// Responsive column count mirrors the legacy max-width cascade (screen-sizes.less):
// 10 cols by default, stepping down at each breakpoint to 3 on the narrowest layout.
const GRID_COLUMNS =
    'grid-cols-10 max-[2200px]:grid-cols-9 max-[1900px]:grid-cols-8 max-[1600px]:grid-cols-7 ' +
    'max-[1300px]:grid-cols-6 max-[1000px]:grid-cols-5 max-[800px]:grid-cols-4 max-[640px]:grid-cols-3';

type LibraryModel = 'library' | 'continue_watching';

type SelectableOption = { value: string; label: string };
type TypeSelect = { options: SelectableOption[]; value?: string; onSelect: (value: string) => void };
type SortChips = { options: SelectableOption[]; selected: string[]; onSelect: (value: string) => void };

const MessageState = ({ label }: { label: string }) => (
    <div className="flex flex-[0_1_auto] flex-col items-center self-stretch overflow-y-auto px-6">
        <Image
            className="mb-8 size-48 flex-none object-contain object-center opacity-90"
            src={require('/assets/images/empty.svg')}
            alt={' '}
        />
        <div className="mb-8 flex-none text-center text-[2rem] font-semibold text-fg">{label}</div>
    </div>
);

const Library = ({ model }: { model: LibraryModel }) => {
    const { type } = useParams();
    const urlParams = useMemo(() => ({ type }), [type]);
    const [queryParams] = useSearchParams();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const profile = useProfile();
    const notifications = useNotifications();
    const [library, loadNextPage] = useLibrary(model, urlParams, queryParams);
    const [typeSelect, sortChips, hasNextPage] = useSelectableInputs(library) as [TypeSelect, SortChips, boolean];

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);

    const selectedSort = sortChips.selected[0];

    const onScrollToBottom = useCallback(() => {
        if (hasNextPage) {
            loadNextPage();
        }
    }, [hasNextPage, loadNextPage]);
    const onScroll = useOnScrollToBottom(onScrollToBottom, SCROLL_TO_BOTTOM_TRESHOLD);

    useLayoutEffect(() => {
        if (scrollContainerRef.current !== null && library.selected && library.selected.request.page === 1 && library.catalog.length !== 0) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [profile.auth, library.selected]);

    useEffect(() => {
        if (!library.selected?.type && typeSelect.value) {
            navigate(toPath(typeSelect.value));
        }
    }, [typeSelect.value, library.selected]);

    // Keep the active sort pill scrolled into view (legacy Chip behavior), for the rare
    // case the sort row overflows horizontally.
    useEffect(() => {
        const active = sortRef.current?.querySelector<HTMLElement>('[data-state="on"]');
        active?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [selectedSort]);

    return (
        <MainNavBars className="h-[calc(100%-var(--safe-area-inset-bottom))] bg-transparent" route={model}>
            <div className="flex h-full w-full flex-col mb-[calc(var(--bottom-overlay-size)*-1)]">
                <div className="z-[2] flex flex-none flex-row items-center gap-6 self-stretch p-6 max-[640px]:justify-between">
                    <div className="flex-[0_1_15rem] rounded-full bg-[var(--overlay-color)] transition-colors hover:bg-surface-hover">
                        <Select value={typeSelect.value} onValueChange={typeSelect.onSelect}>
                            <SelectTrigger className="h-11 w-full justify-between bg-transparent px-6 text-base">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {
                                    typeSelect.options.map(({ value, label }) => (
                                        <SelectItem key={value} value={value} className="text-base">
                                            {label}
                                        </SelectItem>
                                    ))
                                }
                            </SelectContent>
                        </Select>
                    </div>
                    <LazyMotionProvider full>
                        <HorizontalScroll className="flex-1">
                            <ToggleGroup
                                ref={sortRef}
                                type="single"
                                value={selectedSort}
                                onValueChange={(value) => { if (value) sortChips.onSelect(value); }}
                                className="gap-4"
                            >
                                {
                                    sortChips.options.map(({ value, label }) => {
                                        const active = value === selectedSort;
                                        return (
                                            <ToggleGroupItem
                                                key={value}
                                                value={value}
                                                className="relative h-11 shrink-0 bg-transparent px-7 text-base capitalize data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground data-[state=off]:hover:bg-[var(--overlay-color)]"
                                            >
                                                {
                                                    active ?
                                                        <m.span
                                                            layoutId="library-sort-active"
                                                            transition={pillHover}
                                                            className="absolute inset-0 rounded-full bg-primary"
                                                        />
                                                        :
                                                        null
                                                }
                                                <span className="relative z-[1]">{label}</span>
                                            </ToggleGroupItem>
                                        );
                                    })
                                }
                            </ToggleGroup>
                        </HorizontalScroll>
                    </LazyMotionProvider>
                </div>
                {
                    library.selected === null ?
                        <DelayedRenderer delay={500}>
                            <MessageState label={model === 'library' ? t('LIBRARY_NOT_LOADED') : t('BOARD_CONTINUE_WATCHING_NOT_LOADED')} />
                        </DelayedRenderer>
                        :
                        library.catalog.length === 0 ?
                            <MessageState label={model === 'library' ? t('LIBRARY_EMPTY') : t('BOARD_CONTINUE_WATCHING_EMPTY')} />
                            :
                            <div
                                ref={scrollContainerRef}
                                className={`animation-fade-in z-[1] grid flex-1 items-center gap-2 self-stretch overflow-y-auto px-6 [grid-auto-rows:max-content] ${GRID_COLUMNS}`}
                                onScroll={onScroll}
                            >
                                {
                                    library.catalog.map((libItem: Record<string, unknown>, index: number) => (
                                        <LibItem {...libItem} notifications={notifications} removable={model === 'library'} key={index} />
                                    ))
                                }
                            </div>
                }
            </div>
        </MainNavBars>
    );
};

const LibraryFallback = ({ model }: { model: LibraryModel }) => (
    <MainNavBars className="h-[calc(100%-var(--safe-area-inset-bottom))] bg-transparent" route={model} />
);

function withModel(LibraryComponent: React.ComponentType<{ model: LibraryModel }>) {
    const WithModel = () => {
        const location = useLocation();
        const model = useMemo<LibraryModel | null>(() => {
            return typeof location.pathname === 'string' ?
                location.pathname.match('/library') ?
                    'library'
                    :
                    location.pathname.match('/continuewatching') ?
                        'continue_watching'
                        :
                        null
                :
                null;
        }, [location?.pathname]);

        if (model === null) return <NotFound />;

        return <LibraryComponent model={model} />;
    };
    WithModel.displayName = 'withModel';
    return WithModel;
}

export default withModel(withCoreSuspender(Library, LibraryFallback));
