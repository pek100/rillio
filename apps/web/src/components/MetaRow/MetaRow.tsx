// Copyright (C) 2017-2025 Smart code 203358507

/**
 * MetaRow - a titled catalog row. Per the UI-rewrite decisions this KEEPS the fixed
 * fit-to-width N-item layout (not a scroller), so the placeholder-fill width
 * stabilization survives. Ported to TypeScript; the SEE ALL control is now the
 * foundation-kit Button. The structural LESS module is retained because Board and
 * Search compose its `.meta-item` (+ poster-shape) classes to hide/space items per
 * breakpoint - that cross-module contract must hold until those routes are rewritten.
 *
 * itemComponent injection, CATALOG_PREVIEW_SIZE slicing, the ReactIs guard and the
 * fill-with-placeholders logic are reused verbatim.
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from 'rillio/components/ui/button';
import MetaRowPlaceholder from './MetaRowPlaceholder';
import styles from './styles.less';
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
        <div className={cx(className, styles['meta-row-container'])}>
            <div className={styles['header-container']}>
                {
                    typeof catalogTitle === 'string' && catalogTitle.length > 0 ?
                        <div className={styles['title-container']} title={catalogTitle}>{catalogTitle}</div>
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
                    <div className={styles['message-container']} title={message}>{message}</div>
                    :
                    <div className={styles['meta-items-container']}>
                        {
                            ReactIs.isValidElementType(itemComponent) ?
                                items.slice(0, CONSTANTS.CATALOG_PREVIEW_SIZE).map((item: any, index: number) => {
                                    return React.createElement(itemComponent as React.ElementType, {
                                        ...item,
                                        key: index,
                                        className: cx(styles['meta-item'], styles['poster-shape-poster'], styles[`poster-shape-${item.posterShape}`]),
                                        notifications,
                                    });
                                })
                                :
                                null
                        }
                        {Array(Math.max(0, CONSTANTS.CATALOG_PREVIEW_SIZE - items.length)).fill(null).map((_: null, index: number) => (
                            <div key={index} className={cx(styles['meta-item'], styles['poster-shape-poster'])} />
                        ))}
                    </div>
            }
        </div>
    );
};

MetaRow.Placeholder = MetaRowPlaceholder;

export default MetaRow;
