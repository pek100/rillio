// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Inline nav SearchBar. Clean-room rewrite onto the foundation kit (Input +
 * IconButton) with a cmdk-style suggestion panel anchored under the pill (a manual
 * absolute dropdown, NOT Radix Popover: the input must keep focus while the panel is
 * open and Enter must submit the free-text search rather than select a row, so the
 * legacy focus / click-outside / keyboard contract is preserved verbatim).
 *
 * Reused verbatim: useSearchHistory / useLocalSearch (250ms debounce) / usePlayUrl
 * (paste-to-play) / deepLinks.search hrefs / submit-to-/search / focus-on-active /
 * click-outside-to-close. The props contract HorizontalNavBar depends on
 * ({ className, query, active }) is unchanged.
 *
 * Visuals fixed to the design language: the panel drops the old `--outer-glow`
 * shadow-blob for the kit popover surface (bg-popover + shadow-elevated), rows share
 * SearchModal's heading / row styling, and the whole pill sits on the h-10 rhythm.
 * `overflow-visible` overrides the App-wide `* { overflow: hidden }` reset so the
 * panel can escape the pill.
 */

import React, { forwardRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { cn } from 'rillio/components/ui/cn';
import { Input } from 'rillio/components/ui/input';
import { Button, IconButton } from 'rillio/components/ui/button';

const useRouteFocused = require('rillio/common/useRouteFocused').default;
const useBinaryState = require('rillio/common/useBinaryState');
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const { withCoreSuspender } = require('rillio/common/CoreSuspender');
const useSearchHistory = require('./useSearchHistory');
const useLocalSearch = require('./useLocalSearch');
const debounce = require('lodash.debounce');

type Props = {
    className?: string;
    query?: string;
    active?: boolean;
};

// SearchModal's shared heading + row styling, so the two consumers of these hooks
// read as one system.
const HEADING = 'text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg-subtle';
const ROW = 'w-full justify-start rounded-card px-3 py-2 text-left text-sm font-medium text-fg-muted no-underline hover:bg-surface-hover hover:text-fg';

const SearchBar = React.memo(({ className, query, active }: Props) => {
    const { t } = useTranslation();
    const routeFocused = useRouteFocused();
    const searchHistory = useSearchHistory();
    const localSearch = useLocalSearch();
    const navigate = useNavigate();
    const location = useLocation();
    const onSearchRoute = location.pathname.startsWith('/search');
    const { handlePlayUrl } = usePlayUrl();

    const [historyOpen, openHistory, closeHistory] = useBinaryState(query === null ? true : false);
    const [currentQuery, setCurrentQuery] = React.useState(query || '');
    const [, setSearchParams] = useSearchParams();
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const searchBarOnClick = React.useCallback(() => {
        if (!active) {
            navigate('/search');
        }
    }, [active]);

    const searchHistoryOnClose = React.useCallback((event: MouseEvent) => {
        if (historyOpen && containerRef.current && !containerRef.current.contains(event.target as Node)) {
            closeHistory();
        }
    }, [historyOpen]);

    React.useEffect(() => {
        document.addEventListener('mousedown', searchHistoryOnClose);
        return () => {
            document.removeEventListener('mousedown', searchHistoryOnClose);
        };
    }, [searchHistoryOnClose]);

    const queryInputOnChange = React.useCallback(() => {
        const value = searchInputRef.current!.value;
        setCurrentQuery(value);
        openHistory();
    }, []);

    const queryInputOnPaste = React.useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
        const pasted = event.clipboardData.getData('text');
        if (pasted) {
            handlePlayUrl(pasted);
        }
    }, [handlePlayUrl]);

    const queryInputOnSubmit = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        event.preventDefault();
        const value = (event.target as HTMLInputElement).value;
        setCurrentQuery(value);
        closeHistory();
        if (typeof value === 'string' && value.length > 0) {
            // Navigate rather than setSearchParams: the bar now lives in the top
            // nav on every route, and setSearchParams would scribble ?search on
            // whatever route happens to be showing.
            navigate(`/search?search=${encodeURIComponent(value)}`);
        }
    }, [navigate]);

    const queryInputClear = React.useCallback(() => {
        if (searchInputRef.current) {
            searchInputRef.current.value = '';
        }

        setCurrentQuery('');
        // Only reset the URL when the search route is the thing showing results.
        if (onSearchRoute) {
            setSearchParams({});
        }
    }, [onSearchRoute, setSearchParams]);

    const updateLocalSearchDebounced = React.useCallback(debounce((value: string) => {
        localSearch.search(value);
    }, 250), []);

    React.useEffect(() => {
        updateLocalSearchDebounced(currentQuery);
    }, [currentQuery]);

    React.useEffect(() => {
        if (routeFocused && active) {
            searchInputRef.current!.focus();
        }
    }, [routeFocused, active]);

    React.useEffect(() => {
        return () => {
            updateLocalSearchDebounced.cancel();
        };
    }, []);

    const historyItems = searchHistory?.items ?? [];
    const suggestions = localSearch?.items ?? [];

    return (
        <div
            className={cn('relative flex h-10 items-center overflow-visible rounded-full bg-surface transition-colors duration-150 hover:bg-surface-hover', className)}
            onClick={searchBarOnClick}
            ref={containerRef}
        >
            {
                active ?
                    <Input
                        key={query}
                        ref={searchInputRef}
                        type="text"
                        placeholder={t('SEARCH_OR_PASTE_LINK')}
                        defaultValue={query}
                        tabIndex={-1}
                        onChange={queryInputOnChange}
                        onPaste={queryInputOnPaste}
                        onSubmit={queryInputOnSubmit}
                        onClick={openHistory}
                        className="h-full min-w-0 flex-1 rounded-full bg-transparent pl-5 pr-2 font-medium focus-visible:outline-none"
                    />
                    :
                    <div className="flex h-full min-w-0 flex-1 cursor-text items-center pl-5 pr-2 text-sm font-medium text-fg-subtle">
                        <span className="truncate">{t('SEARCH_OR_PASTE_LINK')}</span>
                    </div>
            }
            {
                currentQuery.length > 0 ?
                    <IconButton className="hover:bg-transparent" onClick={queryInputClear}>
                        <X className="size-4" />
                    </IconButton>
                    :
                    <IconButton className="hover:bg-transparent" tabIndex={-1}>
                        <Search className="size-4" />
                    </IconButton>
            }
            {
                historyOpen && (historyItems.length > 0 || suggestions.length > 0) ?
                    <div className="absolute left-0 top-full z-10 mt-2 flex w-full flex-col gap-6 rounded-card bg-popover p-4 text-popover-foreground shadow-elevated">
                        {
                            historyItems.length > 0 ?
                                <div className="flex w-full flex-col gap-1">
                                    <div className="flex items-center justify-between pb-2">
                                        <span className={HEADING}>{t('STREMIO_TV_SEARCH_HISTORY_TITLE')}</span>
                                        <button
                                            type="button"
                                            className="text-xs text-fg-subtle transition-colors duration-150 hover:text-fg"
                                            onClick={searchHistory.clear}
                                        >
                                            {t('CLEAR_HISTORY')}
                                        </button>
                                    </div>
                                    {
                                        historyItems.slice(0, 8).map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                            <Button key={index} variant="ghost" className={ROW} href={deepLinks.search} onClick={closeHistory}>
                                                <Search className="size-4 shrink-0 text-fg-subtle" />
                                                <span className="truncate">{itemQuery}</span>
                                            </Button>
                                        ))
                                    }
                                </div>
                                :
                                null
                        }
                        {
                            suggestions.length > 0 ?
                                <div className="flex w-full flex-col gap-1">
                                    <div className="pb-2">
                                        <span className={HEADING}>{t('SEARCH_SUGGESTIONS')}</span>
                                    </div>
                                    {
                                        suggestions.map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                            <Button key={index} variant="ghost" className={ROW} href={deepLinks.search} onClick={closeHistory}>
                                                <Search className="size-4 shrink-0 text-fg-subtle" />
                                                <span className="truncate">{itemQuery}</span>
                                            </Button>
                                        ))
                                    }
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

SearchBar.displayName = 'SearchBar';

const SearchBarFallback = forwardRef<HTMLLabelElement, Props>(function SearchBarFallback({ className }, ref) {
    const { t } = useTranslation();
    return (
        <label
            ref={ref}
            className={cn('relative flex h-10 items-center overflow-visible rounded-full bg-surface', className)}
        >
            <div className="flex h-full min-w-0 flex-1 items-center pl-5 pr-2 text-sm font-medium text-fg-subtle">
                <span className="truncate">{t('SEARCH_OR_PASTE_LINK')}</span>
            </div>
            <IconButton className="hover:bg-transparent" tabIndex={-1}>
                <Search className="size-4" />
            </IconButton>
        </label>
    );
});

export default withCoreSuspender(SearchBar, SearchBarFallback);
