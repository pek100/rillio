// Copyright (C) 2017-2025 Smart code 203358507

/**
 * MetaRow - a titled catalog row. Per the UI-rewrite decisions this KEEPS the fixed
 * fit-to-width N-item layout (not a scroller), so the placeholder-fill width
 * stabilization survives. Ported to TypeScript; the SEE ALL control is now the
 * foundation-kit Button. The structural LESS module is gone (LESS purge, Stage B):
 * Board and Search no longer compose a `.meta-item` class, they hide/space items per
 * breakpoint via the shared arbitrary-variant hide classes described below.
 *
 * itemComponent injection, CATALOG_PREVIEW_SIZE slicing, the ReactIs guard and the
 * fill-with-placeholders logic are reused verbatim.
 *
 * The per-breakpoint poster trim is NOT here: callers (Board / Search) pass structural
 * arbitrary-variant hide classes on the row's own className (they target `>*:last-child>*:nth-child(...)`,
 * i.e. the items container's children), so no per-item API is needed. Each item's
 * fit-to-width flex-basis is set from its posterShape.
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from 'rillio/components/ui/button';
import MetaRowPlaceholder from './MetaRowPlaceholder';
const ReactIs = require('react-is');
const CONSTANTS = require('rillio/common/CONSTANTS');
const useTranslate = require('rillio/common/useTranslate');

type Props = {
    className?: string;
    title?: string;
    message?: string;
    catalog?: any;
    itemComponent?: React.ElementType;
    notifications?: object;
};

type MetaRowType = React.FC<Props> & { Placeholder?: typeof MetaRowPlaceholder };

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// Fit-to-width flex-basis per poster shape (was `.meta-item.poster-shape-*`). A row
// renders CATALOG_PREVIEW_SIZE items that grow to fill the width; posterShape sets
// the aspect-driven grow factor. Default (unknown shape) is poster, matching the old
// `.poster-shape-poster` base that was always applied.
const SHAPE_FLEX: Record<string, string> = {
    poster: 'flex-[calc(1/var(--poster-shape-ratio))]',
    square: 'flex-1',
    landscape: 'flex-[calc(1/var(--landscape-shape-ratio))]',
};
const shapeFlex = (shape?: string) => SHAPE_FLEX[shape as string] ?? SHAPE_FLEX.poster;

const S = {
    container: 'overflow-visible',
    header: 'flex flex-row items-center justify-end px-4 mb-1 max-[640px]:px-2',
    title: 'flex-1 max-h-[2.4em] text-[1.6rem] font-semibold text-[color:var(--primary-foreground-color)] max-[640px]:mr-2 max-[640px]:whitespace-nowrap max-[640px]:text-ellipsis',
    message: 'max-h-[3.6em] px-2 text-[1.3rem] text-[color:var(--primary-foreground-color)] opacity-60',
    items: 'flex flex-row items-stretch overflow-visible',
};

const MetaRow: MetaRowType = ({ className, title, catalog, message, itemComponent, notifications }) => {
    const t = useTranslate();

    const catalogTitle = React.useMemo(() => {
        return title ?? t.catalogTitle(catalog);
    }, [title, catalog, t.catalogTitle]);

    const items = React.useMemo(() => {
        return catalog?.items ?? catalog?.content?.content;
    }, [catalog]);

    const href = React.useMemo(() => {
        return catalog?.deepLinks?.discover ?? catalog?.deepLinks?.library;
    }, [catalog]);

    return (
        <div className={cx(className, S.container)}>
            <div className={S.header}>
                {
                    typeof catalogTitle === 'string' && catalogTitle.length > 0 ?
                        <div className={S.title} title={catalogTitle}>{catalogTitle}</div>
                        :
                        null
                }
                {
                    href ?
                        <Button
                            variant="ghost"
                            href={href}
                            tabIndex={-1}
                            title={t.string('BUTTON_SEE_ALL')}
                            className="h-10 max-w-48 flex-none flex-row items-center gap-0 rounded-full pl-4 pr-2 text-base font-medium opacity-60 hover:bg-[var(--overlay-color)] hover:opacity-100"
                        >
                            <div className="max-h-[1.2em] flex-[0_1_auto] text-fg">{t.string('BUTTON_SEE_ALL')}</div>
                            <ChevronRight className="ml-2 h-6 flex-none text-fg" />
                        </Button>
                        :
                        null
                }
            </div>
            {
                typeof message === 'string' && message.length > 0 ?
                    <div className={S.message} title={message}>{message}</div>
                    :
                    <div className={S.items}>
                        {
                            ReactIs.isValidElementType(itemComponent) ?
                                items.slice(0, CONSTANTS.CATALOG_PREVIEW_SIZE).map((item: any, index: number) => {
                                    return React.createElement(itemComponent as React.ElementType, {
                                        ...item,
                                        key: index,
                                        className: shapeFlex(item.posterShape),
                                        notifications,
                                    });
                                })
                                :
                                null
                        }
                        {Array(Math.max(0, CONSTANTS.CATALOG_PREVIEW_SIZE - items.length)).fill(null).map((_: null, index: number) => (
                            <div key={index} className={shapeFlex('poster')} />
                        ))}
                    </div>
            }
        </div>
    );
};

MetaRow.Placeholder = MetaRowPlaceholder;

export default MetaRow;
