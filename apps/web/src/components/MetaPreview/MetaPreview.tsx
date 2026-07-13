// Copyright (C) 2017-2025 Smart code 203358507

/**
 * MetaPreview - the meta-details hero panel. Ported to TypeScript with the leaf
 * pieces rebuilt on the foundation kit (ActionsGroup / Ratings / ActionButton /
 * MetaLinks are Tailwind; the share modal is now the kit Dialog). Its own structural
 * layout is now Tailwind too (LESS purge, Stage B): the panel is self-contained - the
 * Player SideDrawer drives the compact variant through the `compact` prop, not by
 * composing hashed classes, so no cross-module CSS contract remains. The `compact`
 * branch reproduces the old `.compact` descendant overrides inline.
 *
 * All domain logic is reused verbatim: the linksGroups sanitizer (URL parse, redirect
 * allowlist, IMDb / SHARE special-casing, hidden-category filter - security relevant),
 * the showHref and metaItemActions memos, and the Ratings core-dispatch wiring.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, BookmarkCheck, Eye, EyeOff, Share2, Play } from 'lucide-react';
import { Imdb } from 'rillio/components/ui/brand-icons';
import Image from 'rillio/components/Image';
import ActionsGroup from 'rillio/components/ActionsGroup';
import { Button } from 'rillio/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui/dialog';
import ActionButton from './ActionButton';
import MetaLinks from './MetaLinks';
import MetaPreviewPlaceholder from './MetaPreviewPlaceholder';
import { Ratings } from './Ratings';
const UrlUtils = require('url');
const SharePrompt = require('rillio/components/SharePrompt').default;
const CONSTANTS = require('rillio/common/CONSTANTS');
const routesRegexp = require('rillio/common/routesRegexp');
const useBinaryState = require('rillio/common/useBinaryState');

const ALLOWED_LINK_REDIRECTS = [
    routesRegexp.search.regexp,
    routesRegexp.discover.regexp,
    routesRegexp.metadetails.regexp,
];

// Categories never rendered as link pills: imdb/share are surfaced elsewhere,
// and cast/directors/writers are noise next to the genres.
const HIDDEN_LINK_CATEGORIES = [
    CONSTANTS.IMDB_LINK_CATEGORY,
    CONSTANTS.SHARE_LINK_CATEGORY,
    CONSTANTS.WRITERS_LINK_CATEGORY,
    'Cast',
    'Directors',
];

const cnj = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// Structural classes (was MetaPreview/styles.less). `compact`-dependent ones are
// functions; the `[@media(orientation:landscape)and(max-width:1000px)and(max-height:500px)]`
// prefix reproduces the old @phone-landscape breakpoint and `max-[640px]` the @minimum.
const LOGO_BASE = 'block max-w-full mb-8 object-contain object-center';
const S = {
    root: 'relative z-0 flex flex-col',
    bgLayer: 'absolute -inset-[10px] z-[-1]',
    bgImage: 'block w-full h-full object-cover object-center blur-[10px] opacity-30',
    info: 'flex-1 self-stretch overflow-y-auto [&:not(:hover)]:[scrollbar-color:transparent_transparent] [&:not(:hover)::-webkit-scrollbar-thumb]:bg-transparent [&:not(:hover)::-webkit-scrollbar-track]:bg-transparent',
    logoImg: (compact?: boolean) => cnj(LOGO_BASE, compact
        ? 'w-full h-24'
        : 'h-36 [@media(orientation:landscape)and(max-width:1000px)and(max-height:500px)]:h-20 [@media(orientation:landscape)and(max-width:1000px)and(max-height:500px)]:mb-4 max-[640px]:my-8 max-[640px]:mx-auto'),
    logoPlaceholder: (compact?: boolean) => cnj('block max-w-full mb-8 text-[1.7rem] text-[color:var(--primary-foreground-color)]', compact && 'w-full h-24'),
    runtimeInfo: (compact?: boolean) => cnj('flex flex-row items-center flex-wrap gap-x-0 gap-y-2 mt-4 overflow-visible max-[640px]:justify-between', compact && 'justify-between'),
    metaActions: 'flex-none ml-auto flex flex-row items-center gap-2 overflow-visible',
    groupContainer: 'h-10',
    runtimeLabel: (compact?: boolean) => cnj('flex-[0_1_auto] text-[1.25rem] font-semibold text-[color:var(--primary-foreground-color)] max-[640px]:m-0', compact ? 'my-4 mx-[0.4rem]' : 'mr-12'),
    imdbButton: 'flex-[0_1_auto] flex flex-row items-center rounded-full px-2 py-0 [border:var(--focus-outline-size)_solid_transparent] [transition:background-color_150ms_var(--ease-smooth,ease)] hover:bg-[var(--overlay-color)] focus:outline-none focus:[border-color:var(--primary-accent-color)]',
    imdbLabel: 'flex-[0_1_auto] mr-4 text-[1.25rem] font-semibold text-[color:var(--primary-foreground-color)]',
    imdbIcon: 'flex-none w-12 h-12 text-[var(--color-imdb)]',
    description: 'mt-4 text-base font-normal leading-[2em] text-[color:var(--primary-foreground-color)]',
    descriptionLabel: 'uppercase text-[0.95rem] font-bold tracking-[0.05em] text-[color:var(--primary-foreground-color)] opacity-40',
    metaLinks: 'mt-6',
    // Rendered only in compact mode, so the old `.compact` justify-between is baked in.
    actionButtons: 'flex-none self-stretch flex flex-row items-end flex-wrap gap-x-4 gap-y-0 pt-14 overflow-visible justify-between [@media(orientation:landscape)and(max-width:1000px)and(max-height:500px)]:pt-6 [@media(orientation:landscape)and(max-width:1000px)and(max-height:500px)]:gap-2 max-[640px]:shrink-0 max-[640px]:mt-12 max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden',
    sharePrompt: 'w-[30rem] max-[640px]:w-auto',
};

type Link = { category?: string; name?: string; url?: string };

type Props = {
    className?: string;
    compact?: boolean;
    name?: string;
    logo?: string;
    background?: string;
    runtime?: string;
    releaseInfo?: string;
    released?: Date;
    description?: string;
    deepLinks?: { metaDetailsVideos?: string; metaDetailsStreams?: string; player?: string };
    links?: Link[];
    inLibrary?: boolean;
    toggleInLibrary?: () => void;
    watched?: boolean;
    toggleWatched?: () => void;
    ratingInfo?: unknown;
};

type MetaPreviewType = React.ForwardRefExoticComponent<Props & React.RefAttributes<HTMLDivElement>> & {
    Placeholder?: typeof MetaPreviewPlaceholder;
};

const MetaPreview = React.forwardRef<HTMLDivElement, Props>(({
    className, compact, name, logo, background, runtime, releaseInfo, released, description,
    deepLinks, links, inLibrary, toggleInLibrary, watched, toggleWatched, ratingInfo,
}, ref) => {
    const { t } = useTranslation();
    const [shareModalOpen, openShareModal, closeShareModal] = useBinaryState(false);

    const linksGroups = React.useMemo(() => {
        return Array.isArray(links) ?
            links
                .filter((link) => link && typeof link.category === 'string' && typeof link.url === 'string')
                .reduce((linksGroups: Map<string, any>, { category, name, url }: Link) => {
                    const { protocol, path, pathname, hostname } = UrlUtils.parse(url as string);
                    if (category === CONSTANTS.IMDB_LINK_CATEGORY) {
                        if (hostname === 'imdb.com') {
                            linksGroups.set(category, {
                                label: name,
                                href: `https://www.stremio.com/warning#${encodeURIComponent(url as string)}`,
                            });
                        }
                    } else if (category === CONSTANTS.SHARE_LINK_CATEGORY) {
                        linksGroups.set(category, { label: name, href: url });
                    } else {
                        if (protocol === 'stremio:') {
                            if (pathname !== null && ALLOWED_LINK_REDIRECTS.some((regexp) => pathname.match(regexp))) {
                                if (!linksGroups.has(category as string)) {
                                    linksGroups.set(category as string, []);
                                }
                                linksGroups.get(category as string).push({ label: name, href: `#${path}` });
                            }
                        } else if (typeof hostname === 'string' && hostname.length > 0) {
                            if (!linksGroups.has(category as string)) {
                                linksGroups.set(category as string, []);
                            }
                            linksGroups.get(category as string).push({
                                label: name,
                                href: `https://www.stremio.com/warning#${encodeURIComponent(url as string)}`,
                            });
                        }
                    }
                    return linksGroups;
                }, new Map())
            :
            new Map();
    }, [links]);

    const showHref = React.useMemo(() => {
        return deepLinks ?
            typeof deepLinks.player === 'string' ?
                deepLinks.player
                :
                typeof deepLinks.metaDetailsStreams === 'string' ?
                    deepLinks.metaDetailsStreams
                    :
                    typeof deepLinks.metaDetailsVideos === 'string' ?
                        deepLinks.metaDetailsVideos
                        :
                        null
            :
            null;
    }, [deepLinks]);

    const renderLogoFallback = React.useCallback(() => (
        <div className={S.logoPlaceholder(compact)}>{name}</div>
    ), [name, compact]);

    const metaItemActions = React.useMemo(() => {
        const actions = [
            {
                icon: inLibrary ? BookmarkCheck : Bookmark,
                label: inLibrary ? t('REMOVE_FROM_LIB') : t('ADD_TO_LIB'),
                onClick: typeof toggleInLibrary === 'function' ? toggleInLibrary : undefined,
            },
            {
                icon: watched ? EyeOff : Eye,
                label: watched ? t('CTX_MARK_UNWATCHED') : t('CTX_MARK_WATCHED'),
                onClick: typeof toggleWatched === 'function' ? toggleWatched : undefined,
            },
        ];
        // Share lives in the same group as library/watched so every action reads as
        // one uniform pill, rather than a lone circular button beside them.
        if (linksGroups.has(CONSTANTS.SHARE_LINK_CATEGORY)) {
            actions.push({ icon: Share2, label: t('CTX_SHARE'), onClick: openShareModal });
        }
        return actions;
    }, [inLibrary, watched, toggleInLibrary, toggleWatched, linksGroups, openShareModal, t]);

    const hasActions = typeof toggleInLibrary === 'function' && typeof toggleWatched === 'function';

    return (
        <div className={cnj(className, S.root)} ref={ref}>
            {
                typeof background === 'string' && background.length > 0 ?
                    <div className={S.bgLayer}>
                        <Image className={S.bgImage} src={background} alt={' '} />
                    </div>
                    :
                    null
            }
            <div className={S.info}>
                {
                    typeof logo === 'string' && logo.length > 0 ?
                        <Image className={S.logoImg(compact)} src={logo} alt={' '} title={name} renderFallback={renderLogoFallback} />
                        :
                        renderLogoFallback()
                }
                {
                    !compact || (typeof releaseInfo === 'string' && releaseInfo.length > 0) || (released instanceof Date && !isNaN(released.getTime())) || (typeof runtime === 'string' && runtime.length > 0) || linksGroups.has(CONSTANTS.IMDB_LINK_CATEGORY) ?
                        <div className={S.runtimeInfo(compact)}>
                            {
                                typeof runtime === 'string' && runtime.length > 0 ?
                                    <div className={S.runtimeLabel(compact)}>{runtime}</div>
                                    :
                                    null
                            }
                            {
                                typeof releaseInfo === 'string' && releaseInfo.length > 0 ?
                                    <div className={S.runtimeLabel(compact)}>{releaseInfo}</div>
                                    :
                                    released instanceof Date && !isNaN(released.getTime()) ?
                                        <div className={S.runtimeLabel(compact)}>{released.getFullYear()}</div>
                                        :
                                        null
                            }
                            {
                                linksGroups.has(CONSTANTS.IMDB_LINK_CATEGORY) ?
                                    <Button
                                        variant="ghost"
                                        className={S.imdbButton}
                                        title={linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).label}
                                        href={linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).href}
                                        target={'_blank'}
                                        tabIndex={0}
                                    >
                                        <div className={S.imdbLabel}>{linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).label}</div>
                                        <Imdb className={S.imdbIcon} />
                                    </Button>
                                    :
                                    null
                            }
                            {
                                !compact ?
                                    <div className={S.metaActions}>
                                        {
                                            hasActions ?
                                                <ActionsGroup items={metaItemActions} className={S.groupContainer} size="sm" />
                                                :
                                                null
                                        }
                                        {
                                            ratingInfo !== null && ratingInfo !== undefined ?
                                                <Ratings ratingInfo={ratingInfo as any} className={S.groupContainer} size="sm" />
                                                :
                                                null
                                        }
                                    </div>
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
                {
                    typeof description === 'string' && description.length > 0 ?
                        <div className={S.description}>
                            {
                                !compact ?
                                    <div className={S.descriptionLabel}>{t('SUMMARY')}</div>
                                    :
                                    null
                            }
                            {description}
                        </div>
                        :
                        null
                }
                {
                    Array.from(linksGroups.keys())
                        .filter((category) => !HIDDEN_LINK_CATEGORIES.includes(category as string))
                        .map((category, index) => (
                            <MetaLinks
                                key={index}
                                className={S.metaLinks}
                                label={category as string}
                                links={linksGroups.get(category as string)}
                            />
                        ))
                }
            </div>
            {
                compact ?
                    <div className={S.actionButtons}>
                        {
                            hasActions ?
                                <ActionsGroup items={metaItemActions} className="mb-4" />
                                :
                                null
                        }
                        {
                            typeof showHref === 'string' ?
                                <ActionButton
                                    className="mb-4 hover:bg-primary focus:bg-primary focus-visible:outline-none"
                                    icon={Play}
                                    label={t('SHOW')}
                                    tabIndex={0}
                                    href={showHref}
                                />
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
            {
                linksGroups.has(CONSTANTS.SHARE_LINK_CATEGORY) ?
                    <Dialog open={shareModalOpen} onOpenChange={(open: boolean) => { if (!open) closeShareModal(); }}>
                        <DialogContent className="max-w-[32rem]">
                            <DialogTitle>{t('CTX_SHARE')}</DialogTitle>
                            <SharePrompt className={S.sharePrompt} url={linksGroups.get(CONSTANTS.SHARE_LINK_CATEGORY).href} />
                        </DialogContent>
                    </Dialog>
                    :
                    null
            }
        </div>
    );
}) as MetaPreviewType;

MetaPreview.Placeholder = MetaPreviewPlaceholder;

export default MetaPreview;
