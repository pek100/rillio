// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Discover - clean-room Tailwind rewrite of the catalog browser.
 *
 * VISUALS ONLY: every data hook (useDiscover / loadNextPage, useSelectableInputs)
 * and navigation contract (onSelect -> navigate(toPath(deepLink))) is reused verbatim
 * from the .js version. The legacy MultiselectMenu filter dropdowns become foundation
 * -kit Radix Selects (portaled, so the old overflow-clip anchoring hacks are gone);
 * the all-filters overflow modal becomes a controlled kit Dialog. The poster grid is
 * the same responsive CSS grid of MetaItem, keeping the externally-passed `selected`
 * class contract for keyboard / gamepad focus highlighting.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useSearchParams } from 'react-router-dom';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';
import { Button, IconButton } from 'rillio/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui/dialog';
import { Select, SelectTrigger, SelectContent, SelectItem } from 'rillio/components/ui/select';
const { CONSTANTS, useBinaryState, useOnScrollToBottom, withCoreSuspender } = require('rillio/common');
const { AddonDetailsModal, DelayedRenderer, Image, MainNavBars, MetaItem } = require('rillio/components');
const useDiscover = require('./useDiscover');
const useSelectableInputs = require('./useSelectableInputs');

const SCROLL_TO_BOTTOM_THRESHOLD = 400;

type SelectOption = { value: string; label: string; title?: string };
type SelectInput = {
    title?: string | (() => string | null);
    options: SelectOption[];
    value?: string | string[];
    onSelect: (value: string) => void;
};

// Shared responsive grid geometry for both the loading skeletons and the real
// posters. Column counts mirror the old styles.less breakpoint chain 1:1 (note the
// intentional 4 -> 5 -> 4 -> 3 wiggle as posters shrink faster than the viewport).
const META_ITEMS_GRID = cn(
    'z-[1] flex-1 self-stretch grid auto-rows-max items-center gap-2 px-6 mr-6 overflow-y-auto',
    'min-[2800px]:grid-cols-10 max-[2800px]:grid-cols-9 max-[2500px]:grid-cols-8 max-[2200px]:grid-cols-7',
    'max-[1900px]:grid-cols-6 max-[1600px]:grid-cols-5 max-[1300px]:grid-cols-4',
    'max-[1000px]:grid-cols-5 max-[1000px]:mr-0 max-[800px]:grid-cols-4 max-[800px]:mr-0 max-[640px]:grid-cols-3',
);

/**
 * FilterSelect - one labelled Radix Select pill. `title` (string or reactive fn)
 * drives the trigger label exactly like the old MultiselectMenu; the accent-dot
 * indicator marks the active option (matching a scalar value OR membership in the
 * catalog select's value array). Selecting an option calls the input's own onSelect,
 * which navigates via the router deep-link.
 */
const FilterSelect = React.memo(({ input, wrapperClassName }: { input: SelectInput; wrapperClassName?: string }) => {
    const { title, options, value, onSelect } = input;
    const selectedOption = useMemo(
        () => options.find((opt) => (Array.isArray(value) ? value.includes(opt.value) : opt.value === value)),
        [options, value],
    );
    const label = typeof title === 'function' ? title() : (title ?? selectedOption?.label);
    const labelText = typeof label === 'string' ? label : undefined;
    return (
        <div className={wrapperClassName}>
            <Select value={selectedOption?.value} onValueChange={onSelect}>
                <SelectTrigger
                    aria-label={labelText}
                    className="h-12 w-full rounded-full bg-[var(--overlay-color)] px-6 hover:brightness-110"
                >
                    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                </SelectTrigger>
                <SelectContent>
                    {options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} title={opt.title}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
});
FilterSelect.displayName = 'FilterSelect';

const Discover = () => {
    const { type, transportUrl, catalogId } = useParams();
    const urlParams = useMemo(() => ({ type, transportUrl, catalogId }), [type, transportUrl, catalogId]);
    const [queryParams] = useSearchParams();
    const { t } = useTranslation();
    const [discover, loadNextPage] = useDiscover(urlParams, queryParams);
    const [selectInputs, hasNextPage] = useSelectableInputs(discover) as [SelectInput[], boolean];
    const [inputsModalOpen, openInputsModal, closeInputsModal] = useBinaryState(false);
    const [addonModalOpen, openAddonModal, closeAddonModal] = useBinaryState(false);
    // Still tracked so keyboard / gamepad focus highlights the active poster.
    const [selectedMetaItemIndex, setSelectedMetaItemIndex] = useState(0);

    const metasContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (discover.catalog?.content.type === 'Loading' && metasContainerRef.current) {
            metasContainerRef.current.scrollTop = 0;
        }
    }, [discover.catalog]);
    useEffect(() => {
        if (hasNextPage && metasContainerRef.current) {
            const containerHeight = metasContainerRef.current.scrollHeight;
            const viewportHeight = metasContainerRef.current.clientHeight;
            if (containerHeight <= viewportHeight + SCROLL_TO_BOTTOM_THRESHOLD) {
                loadNextPage();
            }
        }
    }, [hasNextPage, loadNextPage]);
    const metaItemsOnFocusCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
        const index = (event.target as HTMLElement).dataset.index;
        if (index != null && !isNaN(index as unknown as number)) {
            setSelectedMetaItemIndex(parseInt(index, 10));
        }
    }, []);
    const onScrollToBottom = useCallback(() => {
        if (hasNextPage) {
            loadNextPage();
        }
    }, [hasNextPage, loadNextPage]);
    const onScroll = useOnScrollToBottom(onScrollToBottom, SCROLL_TO_BOTTOM_THRESHOLD);
    useEffect(() => {
        closeInputsModal();
        closeAddonModal();
        setSelectedMetaItemIndex(0);
    }, [discover.selected]);

    // The bar hides the 4th+ filter (and, at the minimum width, the 2nd+); those
    // overflow filters live in the all-filters modal instead. The circular filter
    // button appears whenever a filter is hidden: always with 4+ filters, and at the
    // minimum width with 2+.
    const showFilterButton = selectInputs.length > 3;
    const collapseOnNarrow = selectInputs.length > 1;

    return (
        <MainNavBars className="h-[calc(100%-var(--safe-area-inset-bottom))] bg-transparent" route={'discover'}>
            <div className="flex h-full w-full flex-row mb-[calc(var(--bottom-overlay-size)*-1)]">
                <div className="flex flex-1 flex-col self-stretch [contain:strict]">
                    <div className="z-[2] flex flex-none flex-row gap-6 self-stretch overflow-visible p-6">
                        {selectInputs.map((input, index) => (
                            <FilterSelect
                                key={index}
                                input={input}
                                wrapperClassName="min-w-0 shrink grow-0 basis-60 [&:nth-child(n+4)]:hidden max-[640px]:[&:nth-child(n+2)]:hidden"
                            />
                        ))}
                        <div className="flex flex-1 justify-end">
                            <IconButton
                                size="lg"
                                title={t('ALL_FILTERS')}
                                onClick={openInputsModal}
                                className={cn(
                                    'bg-[var(--overlay-color)] opacity-100 hover:bg-surface-hover active:scale-95 [&_svg]:size-[1.4rem] [&_svg]:text-fg',
                                    showFilterButton ? 'flex' : 'hidden',
                                    collapseOnNarrow && 'max-[640px]:flex',
                                )}
                            >
                                <Icon name={'filters'} />
                            </IconButton>
                        </div>
                    </div>
                    {
                        discover.catalog !== null && !discover.catalog.installed ?
                            <div className="flex flex-none flex-col items-center self-stretch px-6 pb-6">
                                <div className="mb-4 max-h-[2.4em] flex-none text-center text-[1.4rem] text-fg">
                                    {t('ERR_ADDON_NOT_INSTALLED')}
                                </div>
                                <Button
                                    variant="default"
                                    title={t('INSTALL_ADDON')}
                                    onClick={openAddonModal}
                                    className="h-auto min-w-40 max-w-60 rounded-full px-4 py-4 text-center font-medium active:scale-[0.97]"
                                >
                                    {t('ADDON_INSTALL')}
                                </Button>
                            </div>
                            :
                            null
                    }
                    {
                        discover.catalog === null ?
                            <DelayedRenderer delay={500}>
                                <div className="flex flex-[0_1_auto] flex-col items-center self-stretch overflow-y-auto px-6">
                                    <Image className="mb-4 size-48 flex-none object-contain object-center opacity-90" src={require('/assets/images/empty.svg')} alt={' '} />
                                    <div className="flex-none text-center text-[2rem] font-normal text-fg">{t('NO_CATALOG_SELECTED')}</div>
                                </div>
                            </DelayedRenderer>
                            :
                            discover.catalog.content.type === 'Err' ?
                                <div className="flex flex-[0_1_auto] flex-col items-center self-stretch overflow-y-auto px-6">
                                    <Image className="mb-4 size-48 flex-none object-contain object-center opacity-90" src={require('/assets/images/empty.svg')} alt={' '} />
                                    <div className="flex-none text-center text-[2rem] font-normal text-fg">{discover.catalog.content.content}</div>
                                </div>
                                :
                                discover.catalog.content.type === 'Loading' ?
                                    <div ref={metasContainerRef} className={cn(META_ITEMS_GRID, 'animation-fade-in')}>
                                        {Array(CONSTANTS.CATALOG_PAGE_SIZE).fill(null).map((_: null, index: number) => (
                                            <div key={index} className="p-4">
                                                <div className="rounded-[var(--border-radius)] bg-[var(--color-placeholder-background)] pb-[calc(100%*var(--poster-shape-ratio))]" />
                                                <div className="flex h-[2.8rem] flex-row items-center justify-center">
                                                    <div className="h-[1.2rem] w-[60%] flex-none rounded-[var(--border-radius)] bg-[var(--color-placeholder-background)]" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    :
                                    <div ref={metasContainerRef} className={cn(META_ITEMS_GRID, 'animation-fade-in')} onScroll={onScroll} onFocusCapture={metaItemsOnFocusCapture}>
                                        {discover.catalog.content.content.map((metaItem: any, index: number) => (
                                            <MetaItem
                                                key={index}
                                                className={cn({ selected: selectedMetaItemIndex === index })}
                                                type={metaItem.type}
                                                name={metaItem.name}
                                                poster={metaItem.poster}
                                                posterShape={metaItem.posterShape}
                                                deepLinks={metaItem.deepLinks}
                                                watched={metaItem.watched}
                                                data-index={index}
                                            />
                                        ))}
                                    </div>
                    }
                </div>
            </div>
            <Dialog open={inputsModalOpen} onOpenChange={(open) => { if (!open) closeInputsModal(); }}>
                <DialogContent className="max-w-md overflow-visible">
                    <DialogTitle>{t('CATALOG_FILTERS')}</DialogTitle>
                    <div className="flex flex-col gap-4">
                        {selectInputs.map((input, index) => (
                            <FilterSelect
                                key={index}
                                input={input}
                                wrapperClassName="hidden [&:nth-child(n+4)]:flex max-[640px]:hidden max-[640px]:[&:nth-child(n+2)]:flex"
                            />
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
            {
                addonModalOpen && discover.selected !== null ?
                    <AddonDetailsModal transportUrl={discover.selected.request.base} onCloseRequest={closeAddonModal} />
                    :
                    null
            }
        </MainNavBars>
    );
};

const DiscoverFallback = () => (
    <MainNavBars className="h-[calc(100%-var(--safe-area-inset-bottom))] bg-transparent" route={'discover'} />
);

export default withCoreSuspender(Discover, DiscoverFallback);
