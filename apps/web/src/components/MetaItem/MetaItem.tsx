// Copyright (C) 2017-2025 Smart code 203358507

/**
 * MetaItem - the core poster card. Clean-room Tailwind rewrite on the foundation-kit
 * Button (the whole card), DropdownMenu (the more-vertical options menu) and native
 * `title` hints (kept native only on the non-hot-path overlay controls, which exist
 * solely for library / continue-watching cards).
 *
 * Every hook and the selectPrevented contract are reused verbatim: inner overlay
 * controls (dismiss X, play, library / watched toggles, options menu) set
 * `event.nativeEvent.selectPrevented` so the card Button skips its navigate. The
 * live library / watched state comes from useLibraryItemState (one shared
 * subscription keyed by meta id); the metaPreview reconstruction memo serializes the
 * card's own fields for AddToLibrary / MarkAsWatched dispatches.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    X, Check, Bookmark, BookmarkCheck, Eye, EyeOff, Play, Plus, MoreVertical,
    Film, Tv, RadioTower, MonitorPlay, BookOpen, Gamepad2, Music, VenetianMask, Radio, Podcast,
    type LucideIcon,
} from 'lucide-react';
import { useNavigateWithOrigin } from 'rillio-router';
import { cn } from 'rillio/components/ui/cn';
import { Button, IconButton } from 'rillio/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from 'rillio/components/ui/dropdown-menu';
import Image from 'rillio/components/Image';
const filterInvalidDOMProps = require('filter-invalid-dom-props').default;
const useBinaryState = require('rillio/common/useBinaryState');
const useLibraryItemState = require('rillio/common/useLibraryItemState');
const { ICON_FOR_TYPE } = require('rillio/common/CONSTANTS');

// Full literal reveal strings (Tailwind's scanner needs the complete class text).
const REVEAL_OPACITY =
    'group-hover:opacity-100 group-focus-within:opacity-100 group-[.active]:opacity-100 group-[.selected]:opacity-100';
const REVEAL_FLEX =
    'group-hover:flex group-focus-within:flex group-[.active]:flex group-[.selected]:flex';

// Content-type poster fallback glyphs, keyed by the ICON_FOR_TYPE map values.
const TYPE_ICON: Record<string, LucideIcon> = {
    movies: Film,
    series: Tv,
    channels: RadioTower,
    tv: MonitorPlay,
    ic_book: BookOpen,
    ic_games: Gamepad2,
    ic_music: Music,
    ic_adult: VenetianMask,
    ic_radio: Radio,
    ic_podcast: Podcast,
};

type Option = { value: string; label: string };

type Props = {
    className?: string;
    id?: string;
    type?: string;
    name?: string;
    poster?: string;
    posterShape?: 'poster' | 'landscape' | 'square';
    posterChangeCursor?: boolean;
    progress?: number;
    newVideos?: number;
    options?: Option[];
    deepLinks?: { metaDetailsVideos?: string; metaDetailsStreams?: string; player?: string };
    dataset?: Record<string, unknown> & { id?: string };
    optionOnSelect?: (event: {
        type: string;
        value: string;
        dataset?: Record<string, unknown>;
        reactEvent?: React.SyntheticEvent;
        nativeEvent: Event;
    }) => void;
    onDismissClick?: (event: React.MouseEvent) => void;
    onPlayClick?: (event: React.MouseEvent) => void;
    onClick?: (event: React.MouseEvent) => void;
    watched?: boolean;
    inLibrary?: boolean;
};

const MetaItem = React.memo(({
    className, id, type, name, poster, posterShape, posterChangeCursor, progress, newVideos,
    options, deepLinks, dataset, optionOnSelect, onDismissClick, onPlayClick, watched, inLibrary, ...props
}: Props) => {
    const { t } = useTranslation();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [menuOpen, onMenuOpen, onMenuClose] = useBinaryState(false);

    // Live library membership / watched state for this card, keyed by meta id in one
    // shared subscription. Falls back to serialized props until the store has loaded.
    const libraryFallback = useMemo(() => ({
        inLibrary: !!inLibrary,
        watched: !!watched,
    }), [inLibrary, watched]);
    const libraryState = useLibraryItemState(id, libraryFallback);
    const isWatched = libraryState.hasId ? libraryState.watched : !!watched;

    // AddToLibrary / MarkAsWatched expect a meta preview: prefer an explicit dataset
    // preview, else reconstruct the essentials from this card's own fields.
    const metaPreview = useMemo(() => {
        if (dataset && typeof dataset === 'object' && typeof dataset.id === 'string') {
            return dataset;
        }
        return typeof id === 'string' && id.length > 0 ?
            { id, type, name, poster, posterShape }
            :
            null;
    }, [dataset, id, type, name, poster, posterShape]);

    const onToggleInLibraryClick = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).selectPrevented = true;
        libraryState.toggleInLibrary(metaPreview);
    }, [libraryState.toggleInLibrary, metaPreview]);
    const onToggleWatchedClick = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).selectPrevented = true;
        libraryState.toggleWatched(metaPreview);
    }, [libraryState.toggleWatched, metaPreview]);

    const href = useMemo(() => {
        return deepLinks ?
            typeof deepLinks.metaDetailsStreams === 'string' ?
                deepLinks.metaDetailsStreams
                :
                typeof deepLinks.metaDetailsVideos === 'string' ?
                    deepLinks.metaDetailsVideos
                    :
                    typeof deepLinks.player === 'string' ?
                        deepLinks.player
                        :
                        null
            :
            null;
    }, [deepLinks]);

    const metaItemOnClick = useCallback((event: React.MouseEvent) => {
        if ((event.nativeEvent as any).selectPrevented) {
            event.preventDefault();
        } else if (typeof href === 'string') {
            event.preventDefault();
            navigateWithOrigin(href);
        } else if (typeof props.onClick === 'function') {
            props.onClick(event);
        }
    }, [href, navigateWithOrigin, props.onClick]);

    // Inner controls flag the bubbled native event so the card skips navigating.
    const menuTriggerOnClick = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).selectPrevented = true;
    }, []);
    const onDismissLayerClick = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).selectPrevented = true;
        if (typeof onDismissClick === 'function') {
            onDismissClick(event);
        }
    }, [onDismissClick]);
    const onPlayLayerClick = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as any).selectPrevented = true;
        if (typeof onPlayClick === 'function') {
            onPlayClick(event);
        }
    }, [onPlayClick]);
    const menuItemOnSelect = useCallback((value: string, nativeEvent: Event) => {
        if (typeof optionOnSelect === 'function') {
            optionOnSelect({ type: 'select-option', value, dataset, nativeEvent });
        }
    }, [dataset, optionOnSelect]);

    const renderPosterFallback = useCallback(() => {
        const TypeIcon = TYPE_ICON[(ICON_FOR_TYPE.has(type) ? ICON_FOR_TYPE.get(type) : ICON_FOR_TYPE.get('other')) as string] ?? Film;
        return (
            <TypeIcon className="w-4/5 h-1/2 flex-none text-fg opacity-20" />
        );
    }, [type]);

    const posterPad = posterShape === 'square' ?
        'pt-[100%]'
        : posterShape === 'landscape' ?
            'pt-[calc(100%*var(--landscape-shape-ratio))]'
            :
            'pt-[calc(100%*var(--poster-shape-ratio))]';

    const hasName = typeof name === 'string' && name.length > 0;
    const hasOptions = Array.isArray(options) && options.length > 0;

    return (
        <Button
            title={name}
            href={href ?? undefined}
            variant="ghost"
            {...filterInvalidDOMProps(props)}
            className={cn(
                // overflow-visible is a REAL override here: the legacy reset sets
                // `* { overflow: hidden }` (App/styles.less), which would clip the
                // hover-scaled action buttons and the badge layer.
                'group relative flex h-auto flex-col items-stretch justify-start gap-0 overflow-visible whitespace-normal rounded-none p-4 text-base font-normal',
                'hover:z-[1] hover:bg-transparent focus-within:z-[1] focus-visible:outline-none',
                'max-sm:p-2',
                menuOpen && 'active',
                className,
            )}
            onClick={metaItemOnClick}
        >
            <div className={cn(
                'relative z-0 rounded-card bg-surface transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                posterPad,
                'group-hover:scale-[1.02] group-focus-within:scale-[1.02] group-[.active]:scale-[1.02] group-[.selected]:scale-[1.02]',
                'group-hover:shadow-[var(--outer-glow)] group-focus-within:shadow-[var(--outer-glow)] group-[.active]:shadow-[var(--outer-glow)] group-[.selected]:shadow-[var(--outer-glow)]',
                'group-focus-visible:shadow-[var(--outer-glow),0_0_0_var(--focus-outline-size)_var(--color-highlight)]',
            )}>
                {
                    onDismissClick ?
                        <div
                            title={t('LIBRARY_RESUME_DISMISS')}
                            className={cn('absolute left-2 top-2 z-[-2] flex size-6 items-center justify-center rounded-full opacity-0 transition-opacity duration-150', REVEAL_OPACITY)}
                            onClick={onDismissLayerClick}
                        >
                            <X className="relative z-[1] size-5 text-fg opacity-80" />
                            <div className="absolute inset-0 z-0 rounded-full bg-background opacity-60" />
                        </div>
                        :
                        null
                }
                {
                    isWatched ?
                        <div className="absolute left-0 top-0 z-[1] m-2 flex size-6 items-center justify-center rounded-full border-2 border-line bg-background shadow-[var(--outer-glow)]">
                            <Check className="size-3 text-fg" />
                        </div>
                        :
                        null
                }
                {
                    libraryState.hasId ?
                        <div className={cn('absolute right-2 top-2 z-[2] hidden flex-col gap-2', REVEAL_FLEX)}>
                            <IconButton
                                title={libraryState.inLibrary ? t('REMOVE_FROM_LIB') : t('ADD_TO_LIB')}
                                onClick={onToggleInLibraryClick}
                                className="size-7 bg-surface opacity-100 shadow-[var(--outer-glow)] transition-transform duration-150 hover:scale-110 active:scale-95 [&:hover_svg]:text-primary [&_svg]:size-[0.9rem] [&_svg]:text-fg-muted"
                            >
                                {libraryState.inLibrary ? <BookmarkCheck /> : <Bookmark />}
                            </IconButton>
                            <IconButton
                                title={isWatched ? t('CTX_MARK_UNWATCHED') : t('CTX_MARK_WATCHED')}
                                onClick={onToggleWatchedClick}
                                className="size-7 bg-surface opacity-100 shadow-[var(--outer-glow)] transition-transform duration-150 hover:scale-110 active:scale-95 [&:hover_svg]:text-primary [&_svg]:size-[0.9rem] [&_svg]:text-fg-muted"
                            >
                                {isWatched ? <EyeOff /> : <Eye />}
                            </IconButton>
                        </div>
                        :
                        null
                }
                <div className={cn(
                    'absolute inset-0 z-[-3] flex flex-row items-center justify-center transition-[filter] duration-200',
                    'group-hover:brightness-110 group-focus-within:brightness-110 group-[.active]:brightness-110 group-[.selected]:brightness-110',
                    posterChangeCursor && 'hover:cursor-zoom-in',
                )}>
                    <Image
                        className="h-full w-full flex-none object-cover object-center opacity-90 [overflow-clip-margin:unset]"
                        src={poster}
                        alt={' '}
                        renderFallback={renderPosterFallback}
                    />
                </div>
                {
                    onPlayClick ?
                        <div
                            title={t('CONTINUE_WATCHING')}
                            className="absolute left-1/2 top-1/2 z-[-2] -ml-8 -mt-8 flex size-16 items-center justify-center transition-transform duration-150 hover:scale-110"
                            onClick={onPlayLayerClick}
                        >
                            <Play className="relative z-[2] size-9 text-fg" />
                            <div className={cn(
                                'absolute inset-0 z-[1] rounded-full text-fg shadow-[0_0_0_0.15rem_currentColor_inset] transition-colors duration-150',
                                'group-hover:text-transparent group-focus-within:text-transparent group-[.active]:text-transparent group-[.selected]:text-transparent',
                            )} />
                            <div className={cn(
                                'absolute inset-0 z-0 rounded-full bg-background opacity-40 transition-[background-color,opacity] duration-150',
                                'group-hover:bg-primary group-hover:opacity-100 group-focus-within:bg-primary group-focus-within:opacity-100 group-[.active]:bg-primary group-[.active]:opacity-100 group-[.selected]:bg-primary group-[.selected]:opacity-100',
                            )} />
                        </div>
                        :
                        null
                }
                {
                    typeof progress === 'number' && progress > 0 ?
                        <div className="absolute bottom-4 left-4 right-4 z-[-1] h-[0.45rem] overflow-hidden rounded-full">
                            <div className="relative h-full bg-fg" style={{ width: `${progress}%` }} />
                            <div className="absolute inset-0 h-full w-full bg-fg opacity-30" />
                        </div>
                        :
                        null
                }
                {
                    typeof newVideos === 'number' && newVideos > 0 ?
                        // Zero-size anchor: without overflow-visible the global
                        // `* { overflow: hidden }` reset clips the badges entirely.
                        <div className="absolute right-0 top-0 z-[-1] overflow-visible">
                            <div className="absolute right-2 top-2 h-5 w-9 rounded-[0.25rem] bg-fg opacity-40" />
                            <div className="absolute right-3 top-3 h-5 w-9 rounded-[0.25rem] bg-fg opacity-60" />
                            <div className="absolute right-4 top-4 flex h-5 w-9 items-center justify-center gap-0.5 rounded-[0.25rem] bg-fg">
                                <Plus className="size-[0.8rem] text-primary" />
                                <div className="text-[0.8rem] font-semibold text-primary">{newVideos}</div>
                            </div>
                        </div>
                        :
                        null
                }
            </div>
            {
                hasName || hasOptions ?
                    <div className="flex h-16 flex-row items-center overflow-visible max-sm:mt-2">
                        <div className={cn(
                            'line-clamp-2 flex-1 text-center font-semibold text-fg',
                            hasOptions ? 'pl-6' : 'px-2',
                        )}>
                            {hasName ? name : ''}
                        </div>
                        {
                            hasOptions ?
                                <DropdownMenu open={menuOpen} onOpenChange={(open: boolean) => (open ? onMenuOpen() : onMenuClose())}>
                                    <DropdownMenuTrigger asChild>
                                        <div
                                            tabIndex={-1}
                                            onClick={menuTriggerOnClick}
                                            className={cn('z-[1] h-16 w-6 flex-none translate-x-4 bg-transparent py-4 opacity-0 outline-none transition-opacity duration-150', REVEAL_OPACITY)}
                                        >
                                            <MoreVertical className="block h-full w-full text-fg opacity-60" />
                                        </div>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" side="bottom" className="min-w-36 max-w-56">
                                        {
                                            (options ?? []).map((option) => (
                                                <DropdownMenuItem
                                                    key={option.value}
                                                    className="px-6 py-4 font-medium text-fg opacity-80"
                                                    onSelect={(event: Event) => menuItemOnSelect(option.value, event)}
                                                >
                                                    {option.label}
                                                </DropdownMenuItem>
                                            ))
                                        }
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
        </Button>
    );
});

MetaItem.displayName = 'MetaItem';

export default MetaItem;
