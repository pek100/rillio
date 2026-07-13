// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Command palette. Clean-room rewrite onto the kit's cmdk Command (roving-highlight
 * list machinery) while KEEPING the bespoke createPortal + deliberately-un-animated
 * blur backdrop (documented perf choice). It is now a URL-driven modal route
 * (registered at SEARCH_MODAL_PATH in routerPaths, per decisions.md #7) instead of
 * TopNav internal state: it closes by navigating back (useCloseModalRoute), and its
 * core-backed hooks only mount while the route is active (withCoreSuspender).
 *
 * Reused verbatim: useSearchHistory / useLocalSearch (LocalSearch model, 250ms
 * debounce) / usePlayUrl (paste-to-play) / deepLinks.search hrefs / submit-to-/search
 * / focus-restore-on-close. cmdk's own filtering is disabled (shouldFilter=false) -
 * the core model already returns the matched set - and Enter submits the free-text
 * search rather than selecting a row, matching the original behaviour.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCloseModalRoute } from 'rillio-router';
import { Search } from 'lucide-react';
import { cn } from 'rillio/components/ui/cn';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from 'rillio/components/ui/command';

const debounce = require('lodash.debounce');
const useSearchHistory = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useSearchHistory').default;
const useLocalSearch = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useLocalSearch').default;
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const { withCoreSuspender } = require('rillio/common/CoreSuspender');

// URL-driven modal route path (registered in router/routerPaths). Kept here so
// TopNav (the search icon Link) and App (the keyboard shortcut) share one source.
export const SEARCH_MODAL_PATH = '/search-palette';

const ITEM = 'flex items-center gap-2.5 rounded-card px-3 py-2.5 text-sm text-fg-muted data-[selected=true]:bg-surface-hover data-[selected=true]:text-fg';
const HEADING = 'text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg-subtle';

const SearchModal = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const close = useCloseModalRoute();
    const searchHistory = useSearchHistory();
    const localSearch = useLocalSearch();
    const { handlePlayUrl } = usePlayUrl();

    const [query, setQuery] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const runLocalSearch = React.useMemo(() => debounce((value: string) => localSearch.search(value), 250), []);
    React.useEffect(() => {
        runLocalSearch(query);
        return () => runLocalSearch.cancel();
    }, [query]);

    // Focus the field on mount, restore the previously-focused element on close,
    // and close on Escape (the palette has no close button by design).
    React.useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        inputRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [close]);

    // Enter runs the full-text search (not a cmdk row selection). Navigating away
    // unmounts this route, so no explicit close is needed.
    const onInputKeyDown = React.useCallback((event: React.KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        const value = query.trim();
        if (value.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        navigate(`/search?search=${encodeURIComponent(value)}`);
    }, [query, navigate]);

    const onPaste = React.useCallback((event: React.ClipboardEvent) => {
        const pasted = event.clipboardData.getData('text');
        if (pasted) {
            handlePlayUrl(pasted);
        }
    }, [handlePlayUrl]);

    // History/suggestion rows carry a hash deepLink; navigate via the router (strip
    // the leading '#') so it matches the submit path and unmounts the palette.
    const goTo = React.useCallback((href: string) => {
        navigate(href.replace(/^#/, ''));
    }, [navigate]);

    const historyItems = searchHistory?.items ?? [];
    const suggestions = localSearch?.items ?? [];
    const empty = historyItems.length === 0 && suggestions.length === 0;

    return createPortal((
        <div className="fixed inset-0 z-50">
            {/* No entrance animation on the backdrop: animating opacity/transform on
                a backdrop-filter element forces the full-viewport blur to re-rasterize
                every frame (visible as a delayed, janky backdrop). The addon modal's
                backdrop is smooth precisely because it just appears, so match it. */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" onClick={close} />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('SEARCH')}
                className="absolute left-1/2 top-1/2 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-squircle border border-line bg-surface shadow-elevated"
            >
                <Command shouldFilter={false} loop className="bg-transparent">
                    <div className="border-b border-line">
                        <CommandInput
                            ref={inputRef}
                            value={query}
                            onValueChange={setQuery}
                            onKeyDown={onInputKeyDown}
                            onPaste={onPaste}
                            placeholder={t('SEARCH_OR_PASTE_LINK')}
                            className="h-14 text-base"
                        />
                    </div>

                    <CommandList className="max-h-[22rem] p-2">
                        {
                            empty ?
                                <div className={cn(ITEM, 'justify-center text-fg-subtle')}>
                                    {t('SEARCH_OR_PASTE_LINK')}
                                </div>
                                :
                                null
                        }

                        {
                            historyItems.length > 0 ?
                                <CommandGroup
                                    className="p-0"
                                    heading={
                                        <div className="flex items-center justify-between px-3 py-1.5">
                                            <span className={HEADING}>{t('STREMIO_TV_SEARCH_HISTORY_TITLE')}</span>
                                            <button
                                                type="button"
                                                className="text-xs text-fg-subtle transition-colors duration-150 hover:text-fg"
                                                onClick={searchHistory.clear}
                                            >
                                                {t('CLEAR_HISTORY')}
                                            </button>
                                        </div>
                                    }
                                >
                                    {historyItems.slice(0, 8).map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                        <CommandItem key={`history-${index}`} value={`history-${index}`} onSelect={() => goTo(deepLinks.search)} className={ITEM}>
                                            <Search className="size-4 shrink-0 text-fg-subtle" />
                                            <span className="truncate">{itemQuery}</span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                :
                                null
                        }

                        {
                            suggestions.length > 0 ?
                                <CommandGroup
                                    className="p-0"
                                    heading={<span className={cn(HEADING, 'block px-3 py-1.5')}>{t('SEARCH_SUGGESTIONS')}</span>}
                                >
                                    {suggestions.map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                        <CommandItem key={`suggestion-${index}`} value={`suggestion-${index}`} onSelect={() => goTo(deepLinks.search)} className={ITEM}>
                                            <Search className="size-4 shrink-0 text-fg-subtle" />
                                            <span className="truncate">{itemQuery}</span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                :
                                null
                        }
                    </CommandList>
                </Command>
            </div>
        </div>
    ), document.body);
};

export default withCoreSuspender(SearchModal, () => null);
