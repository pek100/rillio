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

// The two left+bottom scrim gradients (color-mix on --color-bg) kept as an inline
// style: multi-stop color-mix() gradients are far clearer here than as a Tailwind
// arbitrary value, and they still read the semantic token.
const SCRIM_BACKGROUND =
    'linear-gradient(to right, color-mix(in srgb, var(--color-bg) 92%, transparent) 0%, color-mix(in srgb, var(--color-bg) 60%, transparent) 42%, color-mix(in srgb, var(--color-bg) 0%, transparent) 74%), ' +
    'linear-gradient(to top, color-mix(in srgb, var(--color-bg) 85%, transparent) 0%, color-mix(in srgb, var(--color-bg) 0%, transparent) 55%)';

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
    const count = items.length;

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

    const item = items[Math.min(index, count - 1)];
    const deepLinks = item.deepLinks || {};
    const watchHref = deepLinks.metaDetailsStreams || deepLinks.player || deepLinks.metaDetailsVideos || undefined;
    const infoHref = deepLinks.metaDetailsVideos || deepLinks.metaDetailsStreams || undefined;

    return (
        <div
            className={cn('relative h-[clamp(18rem,46vh,34rem)] w-full overflow-hidden rounded-card bg-surface', className)}
            onMouseEnter={pause}
            onMouseLeave={resume}
        >
            <div className="absolute inset-0">
                {
                    items.map((it, i) => (
                        <img
                            key={it.id || i}
                            className={cn(
                                'absolute inset-0 h-full w-full object-cover object-[center_25%] opacity-0 transition-opacity duration-700 ease-smooth',
                                i === index && 'opacity-100',
                            )}
                            src={it.background || it.poster || ''}
                            alt={''}
                        />
                    ))
                }
            </div>
            <div className="pointer-events-none absolute inset-0" style={{ background: SCRIM_BACKGROUND }} />

            <div className="absolute bottom-12 left-12 z-[2] flex max-w-[min(34rem,40%)] flex-col items-start gap-4">
                {
                    typeof item.logo === 'string' && item.logo.length > 0 ?
                        <img className="block max-h-28 max-w-[22rem] object-contain object-[left_bottom]" src={item.logo} alt={item.name} />
                        :
                        <div className="text-[2.25rem] font-bold text-fg">{item.name}</div>
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
                the title; side cards select on click. Hidden below 60rem. */}
            <div className="absolute inset-y-0 left-[46%] right-0 z-[1] [perspective:1100px] [transform-style:preserve-3d] max-[60rem]:hidden">
                {
                    items.map((it, i) => {
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
                                <img className="block h-full w-full object-cover" src={it.poster || it.background || ''} alt={''} loading={'lazy'} />
                            </Button>
                        );
                    })
                }
            </div>

            {
                count > 1 ?
                    <div className="absolute bottom-8 right-8 z-[2] flex flex-row items-center gap-[0.4rem]">
                        {
                            items.map((it, i) => (
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
