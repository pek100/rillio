// Copyright (C) 2017-2024 Smart code 203358507

/**
 * HeroCarousel - the board's bespoke 3D poster coverflow hero. Clean-room rewrite
 * (Phase 3 / Wave B) onto Tailwind + the foundation-kit Button. Visual parity is the
 * bar (the map keeps this look and only allows an optional Embla headless engine
 * underneath), so the signed-distance coverflow transforms stay as dynamic inline
 * styles, and each card's multi-duration transition rides on the same inline style so
 * transform / opacity / filter animate exactly as before. Local state only (index,
 * paused, 7s interval); consumes item fields (background, poster, logo, name,
 * description, deepLinks) and renders router-aware <a> hrefs via the kit Button.
 */

import React from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';

const ROTATE_MS = 7000;
// How many cards are visible on each side of the front one.
const VISIBLE_SIDES = 3;

// Left + top + bottom scrim gradients (color-mix on --color-bg) kept as an inline
// style: multi-stop color-mix() gradients are far clearer here than as a Tailwind
// arbitrary value, and they still read the semantic token. They paint over the
// VIEWPORT-TALL backdrop layer: the bottom fade starts transparent mid-screen and
// reaches FULL page color exactly at the viewport bottom, so the first rows sit on
// the gradient's darkening tail rather than below a hero that visibly ends. The
// top fade keeps the floating nav readable over bright art.
const SCRIM_BACKGROUND =
    'linear-gradient(to right, color-mix(in srgb, var(--color-bg) 92%, transparent) 0%, color-mix(in srgb, var(--color-bg) 60%, transparent) 42%, color-mix(in srgb, var(--color-bg) 0%, transparent) 74%), ' +
    'linear-gradient(to bottom, color-mix(in srgb, var(--color-bg) 72%, transparent) 0%, color-mix(in srgb, var(--color-bg) 0%, transparent) 12%), ' +
    'linear-gradient(to bottom, color-mix(in srgb, var(--color-bg) 0%, transparent) 40%, var(--color-bg) 97%)';

// IMDb rating and genres arrive as preview `links` (the core encodes them there);
// category names are the core's constants.
const imdbRatingOf = (item: any): string | null => {
    const link = Array.isArray(item.links) ? item.links.find((l: any) => l?.category === 'imdb') : null;
    return typeof link?.name === 'string' && link.name.length > 0 ? link.name : null;
};
const genresOf = (item: any): string[] => {
    if (!Array.isArray(item.links)) return [];
    return item.links
        .filter((l: any) => l?.category === 'Genres' && typeof l?.name === 'string')
        .map((l: any) => l.name)
        .slice(0, 3);
};

// Per-card transition: transform / opacity glide over 0.65s, filter (the brightness
// dim) over 0.3s. Inline so the exact per-property durations survive (inline wins
// over the Button's base transition utility).
const CARD_TRANSITION =
    'transform 0.65s var(--ease-smooth), opacity 0.65s var(--ease-smooth), filter 0.3s var(--ease-smooth)';

type Props = {
    className?: string,
    items: any[],
};

const HeroCarousel = ({ className, items }: Props) => {
    const { t } = useTranslation();
    const [index, setIndex] = React.useState(0);
    const [paused, setPaused] = React.useState(false);

    // Artwork URLs die (CDN rot); a dead background paints the whole hero black
    // for that slide and a dead poster renders a broken-image ghost card. Track
    // every src that fails and DROP slides with no working art - a missing slide
    // is invisible, a broken one is a bug on screen.
    const [brokenSrcs, setBrokenSrcs] = React.useState<Set<string>>(() => new Set());
    const markBroken = React.useCallback((src: string) => {
        setBrokenSrcs((prev) => prev.has(src) ? prev : new Set(prev).add(src));
    }, []);
    const usable = React.useCallback((...sources: unknown[]) => {
        return sources.find((src): src is string =>
            typeof src === 'string' && src.length > 0 && !brokenSrcs.has(src)) ?? null;
    }, [brokenSrcs]);
    const slides = React.useMemo(() => {
        return items
            .map((item) => ({
                item,
                // The backdrop prefers the wide art, the card the tall art; each
                // falls back to the other before the slide is given up on.
                backdropSrc: usable(item.background, item.poster),
                cardSrc: usable(item.poster, item.background),
            }))
            .filter((slide): slide is { item: any; backdropSrc: string; cardSrc: string } =>
                slide.backdropSrc !== null && slide.cardSrc !== null);
    }, [items, usable]);
    const count = slides.length;

    React.useEffect(() => {
        if (count > 0 && index >= count) {
            setIndex(0);
        }
    }, [count, index]);

    React.useEffect(() => {
        if (paused || count <= 1) {
            return;
        }

        const id = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
        return () => clearInterval(id);
    }, [paused, count]);

    const pause = React.useCallback(() => setPaused(true), []);
    const resume = React.useCallback(() => setPaused(false), []);

    if (count === 0) {
        return null;
    }

    const item = slides[Math.min(index, count - 1)].item;
    const deepLinks = item.deepLinks || {};
    const watchHref = deepLinks.metaDetailsStreams || deepLinks.player || deepLinks.metaDetailsVideos || undefined;
    const infoHref = deepLinks.metaDetailsVideos || deepLinks.metaDetailsStreams || undefined;
    const imdbRating = imdbRatingOf(item);
    const genres = genresOf(item);

    return (
        <div
            className={cn('relative h-[clamp(22rem,58vh,42rem)] w-full', className)}
            onMouseEnter={pause}
            onMouseLeave={resume}
        >
            {/* The backdrop runs PAST the interactive band to the bottom of the
                viewport, where its gradient completes at full page color - the
                first rows render on the darkening tail of the art. Negative z
                (this container deliberately creates no stacking context) drops
                it behind the rows that follow in the scroll container;
                pointer-events-none keeps it out of their way. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-dvh overflow-hidden">
                {
                    slides.map(({ item: it, backdropSrc }, i) => (
                        <img
                            key={it.id || i}
                            className={cn(
                                'absolute inset-0 h-full w-full object-cover object-[center_20%] opacity-0 transition-opacity duration-700 ease-smooth',
                                i === index && 'opacity-100',
                            )}
                            src={backdropSrc}
                            alt={''}
                            onError={() => markBroken(backdropSrc)}
                        />
                    ))
                }
                <div className="absolute inset-0" style={{ background: SCRIM_BACKGROUND }} />
            </div>

            <div className="absolute bottom-12 left-12 z-[2] flex max-w-[min(36rem,44%)] flex-col items-start gap-3.5">
                {
                    typeof item.logo === 'string' && item.logo.length > 0 ?
                        <img className="block max-h-32 max-w-[24rem] object-contain object-[left_bottom]" src={item.logo} alt={item.name} />
                        :
                        <div className="text-[2.5rem] font-extrabold leading-tight tracking-tight text-fg">{item.name}</div>
                }
                {
                    // The meta line: rating badge + facts, then genre chips. Every
                    // piece is optional (catalog previews vary by addon); the row
                    // only renders when at least one exists. The type label earns
                    // its place because the hero MIXES movies and series - without
                    // it a mixed carousel reads ambiguously.
                    imdbRating !== null || item.releaseInfo || item.runtime || genres.length > 0 ?
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
                            {
                                imdbRating !== null ?
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="rounded bg-(--color-imdb) px-1.5 py-px text-xs font-bold text-black">IMDb</span>
                                        <span className="font-semibold tabular-nums text-fg">{imdbRating}</span>
                                    </span>
                                    :
                                    null
                            }
                            {
                                item.type === 'series' || item.type === 'movie' ?
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle">
                                        {item.type === 'series' ? 'Series' : 'Movie'}
                                    </span>
                                    :
                                    null
                            }
                            {item.releaseInfo ? <span className="tabular-nums">{item.releaseInfo}</span> : null}
                            {item.runtime ? <span>{item.runtime}</span> : null}
                            {
                                genres.map((genre) => (
                                    <span key={genre} className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-fg-muted">{genre}</span>
                                ))
                            }
                        </div>
                        :
                        null
                }
                {
                    typeof item.description === 'string' && item.description.length > 0 ?
                        <div className="line-clamp-3 text-[0.95rem] leading-[1.6em] text-fg-muted">{item.description}</div>
                        :
                        null
                }
                <div className="flex flex-row items-center gap-3">
                    {
                        watchHref ?
                            <Button
                                variant="default"
                                className="h-11 px-6 text-[0.95rem] font-bold"
                                href={watchHref}
                                title={t('WATCH_NOW')}
                            >
                                <Play className="size-[1.1rem]" />
                                <div className="whitespace-nowrap">{t('WATCH_NOW')}</div>
                            </Button>
                            :
                            null
                    }
                    {
                        infoHref ?
                            <Button
                                variant="outline"
                                className="h-11 bg-surface px-6 text-[0.95rem] font-bold"
                                href={infoHref}
                                title={t('MORE_INFO')}
                            >
                                <div className="whitespace-nowrap">{t('MORE_INFO')}</div>
                            </Button>
                            :
                            null
                    }
                </div>
            </div>

            {/* Poster coverflow: signed circular distance from the active card
                drives each card's translate/rotate/scale. The front card links to
                the title; side cards select on click. Hidden below 60rem.
                Clips its own overflow now that the hero container cannot (the
                viewport-tall backdrop must escape it); pointer-events-none on the
                clip is inherited-off, and each visible card re-enables itself via
                its inline pointerEvents. */}
            <div className="pointer-events-none absolute inset-y-0 left-[46%] right-0 z-[1] overflow-hidden [perspective:1100px] [transform-style:preserve-3d] max-[60rem]:hidden">
                {
                    slides.map(({ item: it, cardSrc }, i) => {
                        let d = (((i - index) % count) + count) % count;
                        if (d > count / 2) d -= count;
                        const abs = Math.abs(d);
                        const hidden = abs > VISIBLE_SIDES;
                        const front = d === 0;
                        return (
                            <Button
                                key={it.id || i}
                                variant="ghost"
                                className={cn(
                                    'absolute left-1/2 top-1/2 aspect-[2/3] h-[72%] overflow-hidden rounded-xl p-0',
                                    front
                                        ? 'brightness-100 shadow-[0_18px_50px_rgba(0,0,0,0.65)]'
                                        : 'brightness-[0.55] shadow-[0_14px_40px_rgba(0,0,0,0.55)] hover:brightness-[0.8]',
                                )}
                                title={it.name}
                                href={front ? (it.deepLinks?.metaDetailsVideos || it.deepLinks?.metaDetailsStreams || undefined) : undefined}
                                onClick={front ? undefined : () => setIndex(i)}
                                style={{
                                    transform: `translate(-50%, -50%) translateX(${d * 58}%) translateZ(${-abs * 5}rem) rotateY(${d * -24}deg)`,
                                    zIndex: 30 - abs,
                                    opacity: hidden ? 0 : 1,
                                    pointerEvents: hidden ? 'none' : 'auto',
                                    transition: CARD_TRANSITION,
                                }}
                            >
                                <img className="block h-full w-full object-cover" src={cardSrc} alt={''} loading={'lazy'} onError={() => markBroken(cardSrc)} />
                            </Button>
                        );
                    })
                }
            </div>

            {
                count > 1 ?
                    <div className="absolute bottom-8 right-8 z-[2] flex flex-row items-center gap-[0.4rem]">
                        {
                            slides.map(({ item: it }, i) => (
                                <Button
                                    key={it.id || i}
                                    variant="ghost"
                                    className={cn(
                                        'h-2 flex-none p-0 transition-[width,background-color] duration-150 ease-smooth',
                                        i === index ? 'w-6 bg-accent' : 'w-2 bg-white/[0.28] hover:bg-white/[0.5]',
                                    )}
                                    title={it.name}
                                    onClick={() => setIndex(i)}
                                />
                            ))
                        }
                    </div>
                    :
                    null
            }
        </div>
    );
};

export default HeroCarousel;
