// Copyright (C) 2017-2026 Smart code 203358507

import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/common/cn';

const debounce = require('lodash.debounce');
const useSearchHistory = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useSearchHistory');
const useLocalSearch = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useLocalSearch');
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const { withCoreSuspender } = require('rillio/common/CoreSuspender');

type Props = {
    onClose: () => void,
};

const ITEM = 'flex items-center gap-2.5 rounded-card px-3 py-2.5 text-sm text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg';
const HEADING = 'text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg-subtle';

// A centered, blurred-backdrop search palette. Rendered only while open, so its
// core-backed hooks don't run otherwise. Closes on Escape or backdrop click --
// deliberately no close button.
const SearchModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
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

    React.useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        inputRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [onClose]);

    const onSubmit = React.useCallback((event: React.FormEvent) => {
        event.preventDefault();
        const value = query.trim();
        if (value.length === 0) {
            return;
        }

        onClose();
        navigate(`/search?search=${encodeURIComponent(value)}`);
    }, [query, navigate, onClose]);

    const onPaste = React.useCallback((event: React.ClipboardEvent) => {
        const pasted = event.clipboardData.getData('text');
        if (pasted) {
            handlePlayUrl(pasted);
        }
    }, [handlePlayUrl]);

    const historyItems = searchHistory?.items ?? [];
    const suggestions = localSearch?.items ?? [];
    const empty = historyItems.length === 0 && suggestions.length === 0;

    return createPortal((
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xl animation-fade-in" onClick={onClose} />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('SEARCH')}
                className="absolute left-1/2 top-1/2 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-squircle border border-line bg-surface shadow-elevated"
            >
                <form onSubmit={onSubmit} className="flex items-center gap-3 border-b border-line px-4">
                    <Icon className="size-4 shrink-0 text-fg-subtle" name="search" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onPaste={onPaste}
                        placeholder={t('SEARCH_OR_PASTE_LINK')}
                        className="h-14 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
                    />
                </form>

                <div className="max-h-[22rem] overflow-y-auto p-2">
                    {historyItems.length > 0 && (
                        <div className="mb-1">
                            <div className="flex items-center justify-between px-3 py-1.5">
                                <div className={HEADING}>{t('STREMIO_TV_SEARCH_HISTORY_TITLE')}</div>
                                <button
                                    type="button"
                                    className="text-xs text-fg-subtle transition-colors duration-150 hover:text-fg"
                                    onClick={searchHistory.clear}
                                >
                                    {t('CLEAR_HISTORY')}
                                </button>
                            </div>
                            {historyItems.slice(0, 8).map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                <a key={index} href={deepLinks.search} onClick={onClose} className={ITEM}>
                                    <Icon className="size-4 shrink-0 text-fg-subtle" name="search" />
                                    <span className="truncate">{itemQuery}</span>
                                </a>
                            ))}
                        </div>
                    )}

                    {suggestions.length > 0 && (
                        <div>
                            <div className="px-3 py-1.5">
                                <div className={HEADING}>{t('SEARCH_SUGGESTIONS')}</div>
                            </div>
                            {suggestions.map(({ query: itemQuery, deepLinks }: any, index: number) => (
                                <a key={index} href={deepLinks.search} onClick={onClose} className={ITEM}>
                                    <Icon className="size-4 shrink-0 text-fg-subtle" name="search" />
                                    <span className="truncate">{itemQuery}</span>
                                </a>
                            ))}
                        </div>
                    )}

                    {empty && (
                        <div className={cn(ITEM, 'pointer-events-none justify-center text-fg-subtle hover:bg-transparent')}>
                            {t('SEARCH_OR_PASTE_LINK')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    ), document.body);
};

export default withCoreSuspender(SearchModal, () => null);
