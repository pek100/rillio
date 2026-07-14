// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Command palette. Clean-room rewrite onto the kit's cmdk Command (roving-highlight
 * list machinery) while KEEPING the bespoke createPortal + deliberately-un-animated
 * blur backdrop (documented perf choice). It is a bus-driven modal (common/modalEvents)
 * mounted by ModalHost: it takes an `onClose` (a pure bus close, never a history
 * navigation).
 *
 * Shell / body split (fixes the open flicker): the portal, backdrop, role=dialog frame
 * and the search INPUT live in the shell, which consumes no core state and so mounts
 * once and stays mounted (the input keeps focus, the backdrop never re-appears). Only
 * the suggestion list (SearchBody) reads core models (useSearchHistory / useLocalSearch
 * / usePlayUrl), so ONLY it sits inside withCoreSuspender; when those reads suspend on
 * first open, just the list swaps to an empty fallback, never the input or the dialog.
 *
 * Reused verbatim: useSearchHistory / useLocalSearch (LocalSearch model, 250ms
 * debounce) / usePlayUrl (paste-to-play) / deepLinks.search hrefs / submit-to-/search
 * / focus-restore-on-close. cmdk's own filtering is disabled (shouldFilter=false) -
 * the core model already returns the matched set - and Enter submits the free-text
 * search rather than selecting a row, matching the original behaviour. Navigating to a
 * real route (a suggestion, the submit, or paste-to-play) closes the palette via the bus.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Command, CommandInput } from 'rillio/components/ui/command';
import SearchSuggestions from 'rillio/components/SearchSuggestions';

const debounce = require('lodash.debounce');
const useSearchHistory = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useSearchHistory').default;
const useLocalSearch = require('rillio/components/NavBar/HorizontalNavBar/SearchBar/useLocalSearch').default;
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const { withCoreSuspender } = require('rillio/common/CoreSuspender');

const EMPTY_ROW = 'flex items-center justify-center gap-2.5 rounded-card px-3 py-2.5 text-sm text-fg-subtle';

type PlayUrlRef = React.MutableRefObject<((text: string) => Promise<boolean>) | null>;

type BodyProps = {
    query: string,
    onClose: () => void,
    // The shell's onPaste handler (registered on the persistent input) reads the
    // paste-to-play routine through this ref, because usePlayUrl reads the streaming
    // server model and so can only run inside the suspending body.
    playUrlRef: PlayUrlRef,
};

// The core-consuming body: history + local-search suggestions, and the paste-to-play
// routine it publishes to the shell. Rendered inside the shell's <Command> so cmdk's
// list context reaches the suggestions.
const SearchBody = ({ query, onClose, playUrlRef }: BodyProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const searchHistory = useSearchHistory();
    const localSearch = useLocalSearch();
    const { handlePlayUrl } = usePlayUrl();

    // Publish the paste-to-play routine to the shell's persistent input.
    React.useEffect(() => {
        playUrlRef.current = handlePlayUrl;
        return () => { playUrlRef.current = null; };
    }, [handlePlayUrl, playUrlRef]);

    const runLocalSearch = React.useMemo(() => debounce((value: string) => localSearch.search(value), 250), []);
    React.useEffect(() => {
        runLocalSearch(query);
        return () => runLocalSearch.cancel();
    }, [query]);

    // History/suggestion rows carry a hash deepLink; navigate via the router (strip
    // the leading '#') so it matches the submit path, then close the palette.
    const goTo = React.useCallback((href: string) => {
        navigate(href.replace(/^#/, ''));
        onClose();
    }, [navigate, onClose]);

    const historyItems = searchHistory?.items ?? [];
    const suggestions = localSearch?.items ?? [];
    const empty = historyItems.length === 0 && suggestions.length === 0;

    return (
        <SearchSuggestions
            historyItems={historyItems}
            suggestions={suggestions}
            onClearHistory={searchHistory.clear}
            onSelect={goTo}
            listClassName="max-h-[22rem] p-2"
            empty={empty ?
                <div className={EMPTY_ROW}>
                    {t('SEARCH_OR_PASTE_LINK')}
                </div>
                :
                null
            }
        />
    );
};

// Empty fallback: the input + frame are in the shell, so the list simply stays blank
// (no size to preserve here - the suggestion area grows from empty anyway) for the
// sub-frame the core reads take to resolve.
const SearchBodySuspended = withCoreSuspender(SearchBody, () => null);

type Props = {
    onClose: () => void,
};

const SearchModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const close = onClose;

    const [query, setQuery] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);
    const playUrlRef: PlayUrlRef = React.useRef(null);

    // Focus the field on mount, restore the previously-focused element on close,
    // and close on Escape (the palette has no close button by design). The shell
    // mounts once, so this runs once - the input is never re-created mid-open.
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

    // Enter runs the full-text search (not a cmdk row selection), then closes the
    // palette (the bus close, since navigating no longer unmounts it).
    const onInputKeyDown = React.useCallback((event: React.KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        const value = query.trim();
        if (value.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        navigate(`/search?search=${encodeURIComponent(value)}`);
        close();
    }, [query, navigate, close]);

    const onPaste = React.useCallback((event: React.ClipboardEvent) => {
        const pasted = event.clipboardData.getData('text');
        if (pasted) {
            // Only close if it was a playable URL/magnet (handlePlayUrl navigated).
            // playUrlRef is set once the body resolves (a frame after open); a paste
            // in that first frame simply falls through to plain text, as before.
            playUrlRef.current?.(pasted).then((handled: boolean) => { if (handled) close(); });
        }
    }, [close]);

    return createPortal((
        <div className="fixed inset-0 z-50">
            {/* Static appear, no entrance animation - a deliberate design choice, not a
                missing polish. In 2026 Chromium/WebView2 animating a live full-viewport
                backdrop-filter is still structurally broken, not merely janky: animating
                the blur RADIUS re-runs a full-viewport GPU convolution every frame
                (compositing offloads the property mutation, not the raster, so the frame
                budget blows out), and fading the layer's OPACITY is worse - opacity < 1
                turns the element into a "backdrop root", so mid-fade the blur can no longer
                reach the page behind it (the still-open Chromium flicker bug 1194050 /
                40175472). The addon modal's backdrop is smooth precisely because it just
                appears, so match it. */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-(--scrim-blur)" onClick={close} />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('SEARCH')}
                // Exactly the DialogContent material (this panel is hand-rolled, not a kit
                // Dialog, so it has to name the same classes): panel-tint + bg-card, a
                // border-line hairline and shadow-elevated. The scrim above carries the
                // blur, so the panel takes none (one blur per stacking context).
                className="panel-tint absolute left-1/2 top-1/2 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-squircle border border-line bg-card text-card-foreground shadow-elevated"
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

                    <SearchBodySuspended query={query} onClose={close} playUrlRef={playUrlRef} />
                </Command>
            </div>
        </div>
    ), document.body);
};

export default SearchModal;
