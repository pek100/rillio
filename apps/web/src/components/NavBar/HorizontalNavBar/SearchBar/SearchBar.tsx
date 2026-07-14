// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Inline nav SearchBar. Clean-room rewrite onto the foundation kit (Input + IconButton)
 * with a cmdk-driven suggestion panel anchored under the pill. It shares the row/heading
 * list machinery with the SearchModal palette via the headless <SearchSuggestions>
 * component (dedup: one primitive, two consumers), and keeps its own pill + dropdown
 * shape.
 *
 * cmdk keeps DOM focus in the input (ARIA combobox: a virtual highlight moves, focus
 * never leaves), which is the invariant this bar needs. Enter behaviour is conditional:
 * with no row actively highlighted it submits the free-text search; after the user arrows
 * into a row it selects that row. Mechanism: an `armed` flag tracks whether the user has
 * pressed an arrow key since the last edit. On Enter, if unarmed we preventDefault +
 * stopPropagation (stopping cmdk's root keydown from selecting the auto-highlighted first
 * row) and navigate the free text; if armed we let the keydown bubble so cmdk selects the
 * highlighted row. `armed` also gates the row highlight visually, so no row looks selected
 * until the user actually arrows.
 *
 * Reused verbatim: useSearchHistory / useLocalSearch (250ms debounce) / usePlayUrl
 * (paste-to-play) / deepLinks.search hrefs / submit-to-/search / focus-on-active /
 * click-outside-to-close. The props contract HorizontalNavBar depends on
 * ({ className, query, active }) is unchanged.
 */

import React, { forwardRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Command as CommandPrimitive } from 'cmdk';
import { Search, X } from 'lucide-react';
import { cn } from 'rillio/components/ui/cn';
import { IconButton } from 'rillio/components/ui/button';
import SearchSuggestions from 'rillio/components/SearchSuggestions';

const useRouteFocused = require('rillio/common/useRouteFocused').default;
const useBinaryState = require('rillio/common/useBinaryState');
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const { withCoreSuspender } = require('rillio/common/CoreSuspender');
const useSearchHistory = require('./useSearchHistory').default;
const useLocalSearch = require('./useLocalSearch').default;
const debounce = require('lodash.debounce');

type Props = {
    className?: string;
    query?: string;
    active?: boolean;
};

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
    // `armed` = the user has arrowed into a row since the last edit, so Enter should select
    // it rather than submit free text. The ref keeps the synchronous read in onKeyDown fresh;
    // the state drives the visual highlight gating.
    const [armed, setArmed] = React.useState(false);
    const armedRef = React.useRef(false);
    const [, setSearchParams] = useSearchParams();
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const disarm = React.useCallback(() => {
        armedRef.current = false;
        setArmed(false);
    }, []);

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

    const queryInputOnValueChange = React.useCallback((value: string) => {
        disarm();
        setCurrentQuery(value);
        openHistory();
    }, [disarm]);

    const queryInputOnPaste = React.useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
        const pasted = event.clipboardData.getData('text');
        if (pasted) {
            handlePlayUrl(pasted);
        }
    }, [handlePlayUrl]);

    const queryInputOnKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            armedRef.current = true;
            setArmed(true);
            return; // let cmdk move the highlight
        }
        if (event.key !== 'Enter') {
            return;
        }
        if (armedRef.current) {
            // A row is highlighted: let the keydown bubble to cmdk's root, which selects it
            // (the row's onSelect navigates). Nothing to do here.
            return;
        }
        // Free-text submit: stop cmdk from selecting the auto-highlighted first row.
        event.preventDefault();
        event.stopPropagation();
        const value = currentQuery.trim();
        closeHistory();
        if (value.length > 0) {
            // Navigate rather than setSearchParams: the bar now lives in the top nav on
            // every route, and setSearchParams would scribble ?search on whatever route
            // happens to be showing.
            navigate(`/search?search=${encodeURIComponent(value)}`);
        }
    }, [currentQuery, navigate, closeHistory]);

    const queryInputClear = React.useCallback(() => {
        disarm();
        setCurrentQuery('');
        // Only reset the URL when the search route is the thing showing results.
        if (onSearchRoute) {
            setSearchParams({});
        }
    }, [onSearchRoute, setSearchParams, disarm]);

    // History/suggestion rows carry a hash deepLink; navigate via the router (strip the
    // leading '#') so it matches the submit path.
    const goTo = React.useCallback((href: string) => {
        navigate(href.replace(/^#/, ''));
    }, [navigate]);

    const updateLocalSearchDebounced = React.useCallback(debounce((value: string) => {
        localSearch.search(value);
    }, 250), []);

    // The field is now controlled, so resync it when the route query changes (navigation),
    // which the old uncontrolled defaultValue + key remount did implicitly. User typing
    // changes currentQuery locally without touching the query prop, so this never clobbers
    // in-progress input.
    React.useEffect(() => {
        setCurrentQuery(query || '');
        disarm();
    }, [query]);

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
    const hasItems = historyItems.length > 0 || suggestions.length > 0;

    return (
        <CommandPrimitive
            ref={containerRef as any}
            shouldFilter={false}
            loop
            className={cn('relative flex h-10 items-center overflow-visible rounded-full bg-surface transition-colors duration-150 hover:bg-surface-hover', className)}
            onClick={searchBarOnClick}
        >
            {
                active ?
                    <CommandPrimitive.Input
                        key={query}
                        ref={searchInputRef}
                        value={currentQuery}
                        placeholder={t('SEARCH_OR_PASTE_LINK')}
                        onValueChange={queryInputOnValueChange}
                        onPaste={queryInputOnPaste}
                        onKeyDown={queryInputOnKeyDown}
                        onClick={openHistory}
                        className="h-full min-w-0 flex-1 rounded-full bg-transparent pl-5 pr-2 text-sm font-medium text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
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
                historyOpen && hasItems ?
                    <div className="absolute left-0 top-full z-10 mt-2 w-full rounded-card border border-line bg-popover p-2 text-popover-foreground shadow-elevated backdrop-blur-(--glass-blur)">
                        <SearchSuggestions
                            historyItems={historyItems}
                            suggestions={suggestions}
                            onClearHistory={searchHistory.clear}
                            onSelect={goTo}
                            onRowActivate={closeHistory}
                            // Until the user arrows, neutralise cmdk's default first-row
                            // highlight so no row looks selected while Enter still submits
                            // free text.
                            listClassName={cn('max-h-[70vh] overflow-y-auto', !armed && '[&_[cmdk-item][data-selected=true]]:bg-transparent [&_[cmdk-item][data-selected=true]]:text-fg-muted')}
                        />
                    </div>
                    :
                    null
            }
        </CommandPrimitive>
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
