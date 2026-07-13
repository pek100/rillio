// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Search results route (clean-room rewrite of Search.js onto Tailwind on our semantic
 * tokens). The TopNav-owned search field lives outside this route; here we only render
 * the grouped catalog rows for the current query.
 *
 * Every hook and helper is reused verbatim: useSearch (LoadRange windowing),
 * getVisibleChildrenRange + 250ms debounce + useLayoutEffect re-run, the tri-state
 * (Ready | Err | Loading) catalog.content contract, and withCoreSuspender. The row
 * atom (MetaRow / MetaRow.Placeholder) and MetaItem are the redesigned Wave A
 * components, consumed unchanged.
 *
 * The one non-obvious port: the LESS module used `:import`ed `.meta-item` classes to
 * hide overflow posters per breakpoint. That cross-module contract is preserved here
 * with structural arbitrary variants that hide the row's overflow children at the same
 * breakpoints (2200/1900/1600/1300/1000/800/640px), so each row stays a fit-to-width
 * strip exactly as before.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';

const debounce = require('lodash.debounce');
const useTranslate = require('rillio/common/useTranslate');
const { withCoreSuspender, getVisibleChildrenRange } = require('rillio/common');
const { Image, MainNavBars, MetaItem, MetaRow } = require('rillio/components');
const useSearch = require('./useSearch');

const THRESHOLD = 100;

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const ROW_BASE = 'mt-4 mb-8 max-[640px]:mb-6 animation-fade-in';

// Overflow-poster hiding: hide the row's trailing item children once the viewport is
// too narrow to fit them, mirroring the old nth-child media queries. `>*:last-child` is
// the meta-items container (Ready + placeholder rows both end with it); its children are
// the poster items.
const HIDE_POSTER =
    'max-[2200px]:[&>*:last-child>*:nth-child(n+10)]:hidden ' +
    'max-[1900px]:[&>*:last-child>*:nth-child(n+9)]:hidden ' +
    'max-[1600px]:[&>*:last-child>*:nth-child(n+8)]:hidden ' +
    'max-[1300px]:[&>*:last-child>*:nth-child(n+7)]:hidden ' +
    'max-[1000px]:[&>*:last-child>*:nth-child(n+6)]:hidden ' +
    'max-[800px]:[&>*:last-child>*:nth-child(n+5)]:hidden ' +
    'max-[640px]:[&>*:last-child>*:nth-child(n+4)]:hidden';

const HIDE_LANDSCAPE =
    'max-[2200px]:[&>*:last-child>*:nth-child(n+9)]:hidden ' +
    'max-[1900px]:[&>*:last-child>*:nth-child(n+8)]:hidden ' +
    'max-[1600px]:[&>*:last-child>*:nth-child(n+7)]:hidden ' +
    'max-[1300px]:[&>*:last-child>*:nth-child(n+6)]:hidden ' +
    'max-[1000px]:[&>*:last-child>*:nth-child(n+5)]:hidden ' +
    'max-[800px]:[&>*:last-child>*:nth-child(n+4)]:hidden';

const hideClassesForShape = (posterShape: string | undefined): string =>
    posterShape === 'landscape' ? HIDE_LANDSCAPE : HIDE_POSTER;

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
                            <div className={'flex flex-col items-center p-16'}>
                                <Image
                                    className={'mb-4 size-48 flex-none object-contain object-center opacity-90'}
                                    src={require('/assets/images/empty.svg')}
                                    alt={' '}
                                />
                                <div className={'text-center text-[2.5rem] text-fg-muted'}>{ t.string('STREMIO_TV_SEARCH_NO_ADDONS') }</div>
                            </div>
                            :
                            search.catalogs.map((catalog: any, index: number) => {
                                switch (catalog.content?.type) {
                                    case 'Ready': {
                                        return (
                                            <MetaRow
                                                key={index}
                                                className={cx(ROW_BASE, hideClassesForShape(catalog.content.content[0].posterShape))}
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
                                                    className={ROW_BASE}
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
                                                className={cx(ROW_BASE, HIDE_POSTER)}
                                                catalog={catalog}
                                                title={t.catalogTitle(catalog)}
                                            />
                                        );
                                    }
                                }
                            })
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
