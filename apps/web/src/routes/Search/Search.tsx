// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Search results route (clean-room rewrite of Search.js onto Tailwind on our semantic
 * tokens). The TopNav-owned search field lives outside this route; here we only render
 * the grouped catalog rows for the current query.
 *
 * Every hook and helper is reused verbatim: useSearch (LoadRange windowing),
 * getVisibleChildrenRange + 250ms debounce + useLayoutEffect re-run, and
 * withCoreSuspender. The grouped catalog rows (the Ready | Err | Loading tri-state and
 * the per-breakpoint overflow-poster trim) are the shared components/CatalogRows, the
 * same mapper the Board route uses; the no-addons message is the shared EmptyState.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';

const debounce = require('lodash.debounce');
const useTranslate = require('rillio/common/useTranslate');
const { withCoreSuspender, getVisibleChildrenRange } = require('rillio/common');
const { MainNavBars, CatalogRows, EmptyState } = require('rillio/components');
const useSearch = require('./useSearch').default;

const THRESHOLD = 100;

const CONTAINER_CLASS = 'h-[calc(100%-var(--safe-area-inset-bottom))] w-full bg-transparent';

const Search = () => {
    const [queryParams] = useSearchParams();
    const t = useTranslate();
    const [search, loadSearchRows] = useSearch(queryParams);
    const query = React.useMemo(() => {
        return search.selected !== null ?
            search.selected.extra.reduceRight((query: string | null, [name, value]: [string, string]) => {
                if (name === 'search') {
                    return value;
                }

                return query;
            }, null)
            :
            null;
    }, [search.selected]);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const onVisibleRangeChange = React.useCallback(() => {
        if (search.catalogs.length === 0) {
            return;
        }

        const range = getVisibleChildrenRange(scrollContainerRef.current, THRESHOLD);
        if (range === null) {
            return;
        }

        loadSearchRows(range);
    }, [search.catalogs]);
    const onScroll = React.useCallback(debounce(onVisibleRangeChange, 250), [onVisibleRangeChange]);
    React.useLayoutEffect(() => {
        onVisibleRangeChange();
    }, [search.catalogs, onVisibleRangeChange]);
    return (
        <MainNavBars className={CONTAINER_CLASS} route={'search'} query={query}>
            <div ref={scrollContainerRef} className={'h-full w-full overflow-y-auto px-4'} onScroll={onScroll}>
                {
                    // No query: nothing to show. The search field lives in the top
                    // nav and expands in place, so there is no landing page to sit on.
                    query === null ?
                        null
                        :
                        search.catalogs.length === 0 ?
                            <EmptyState
                                className={'p-16'}
                                imageClassName={'mb-4'}
                                labelClassName={'text-[2.5rem] text-fg-muted'}
                                label={t.string('STREMIO_TV_SEARCH_NO_ADDONS')}
                            />
                            :
                            <CatalogRows catalogs={search.catalogs} />
                }
            </div>
        </MainNavBars>
    );
};

const SearchFallback = () => {
    const [queryParams] = useSearchParams();
    return <MainNavBars className={CONTAINER_CLASS} route={'search'} query={queryParams.get('search') ?? queryParams.get('query')} />;
};

export default withCoreSuspender(Search, SearchFallback);
