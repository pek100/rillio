// Copyright (C) 2017-2025 Smart code 203358507

/**
 * HeroMedia (Phase 3 clean-room rewrite) - the hero's 16:9 media panel, a banner
 * carousel. Slides are the backdrop still plus each trailer as a VIDEO slide, paused
 * by default (autoplay=0; the user presses YouTube's own play). Image slides
 * crossfade and auto-advance gently; a video slide never auto-advances and its
 * iframe is mounted only while active so cycling away stops playback.
 *
 * View rebuilt on Tailwind tokens + the kit IconButton for the arrows; the
 * slide-model / active-index / auto-advance behavior is preserved verbatim. This
 * keeps the current opacity crossfade rather than adopting the Embla translate
 * slider, because the crossfade + active-only iframe mount + image-only autoplay
 * are the load-bearing behavior here (see the route report deviation note).
 */

import React from 'react';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';
import { IconButton } from 'rillio/components/ui/button';

type Props = {
    className?: string,
    ytIds?: string[],
    background?: string | null,
    poster?: string | null,
    name?: string,
};

type Slide =
    | { type: 'image', src: string }
    | { type: 'video', ytId: string };

const AUTO_ADVANCE_MS = 7000;

const HeroMedia = ({ className, ytIds, background, poster, name }: Props) => {
    const slides = React.useMemo<Slide[]>(() => {
        const out: Slide[] = [];
        const still = background || poster || null;
        if (still) out.push({ type: 'image', src: still });
        (ytIds || []).slice(0, 3).forEach((ytId) => out.push({ type: 'video', ytId }));
        return out;
    }, [ytIds, background, poster]);

    const [active, setActive] = React.useState(0);
    const count = slides.length;

    const go = React.useCallback((delta: number) => {
        setActive((a) => (a + delta + count) % count);
    }, [count]);

    // Gentle auto-advance, image slides only (a paused/playing trailer stays put).
    React.useEffect(() => {
        if (count < 2 || slides[active]?.type !== 'image') return undefined;
        const id = setTimeout(() => setActive((a) => (a + 1) % count), AUTO_ADVANCE_MS);
        return () => clearTimeout(id);
    }, [active, count, slides]);

    // Meta changed (new title): restart from the first slide.
    React.useEffect(() => { setActive(0); }, [slides]);

    const panelClassName = 'group relative w-full overflow-hidden rounded-[12px] bg-surface aspect-video';

    if (count === 0) {
        return (
            <div className={cn(panelClassName, className)}>
                <div className="absolute inset-0 bg-surface" />
            </div>
        );
    }

    return (
        <div className={cn(panelClassName, className)}>
            {slides.map((slide, index) => (
                slide.type === 'image' ?
                    <img
                        key={index}
                        className={cn(
                            'absolute inset-0 h-full w-full object-cover object-[center_25%] transition-opacity duration-[400ms]',
                            index !== active && 'pointer-events-none opacity-0',
                        )}
                        src={slide.src}
                        alt={name || ''}
                    />
                    :
                    // Mount the iframe only while its slide is active so a playing
                    // trailer stops when the user cycles away.
                    index === active ?
                        <iframe
                            key={index}
                            className="absolute inset-0 h-full w-full border-0"
                            src={`https://www.youtube-nocookie.com/embed/${slide.ytId}?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`}
                            title={name || 'Trailer'}
                            allow={'encrypted-media; picture-in-picture'}
                            allowFullScreen
                        />
                        :
                        null
            ))}

            {
                count > 1 ?
                    <React.Fragment>
                        <IconButton
                            aria-label={'Previous'}
                            onClick={() => go(-1)}
                            className="absolute left-2.5 top-1/2 z-[2] size-9 -translate-y-1/2 bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] opacity-0 backdrop-blur-[4px] transition group-hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--color-bg)_75%,transparent)]"
                        >
                            <Icon className="size-4 text-fg" name={'chevron-back'} />
                        </IconButton>
                        <IconButton
                            aria-label={'Next'}
                            onClick={() => go(1)}
                            className="absolute right-2.5 top-1/2 z-[2] size-9 -translate-y-1/2 bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] opacity-0 backdrop-blur-[4px] transition group-hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--color-bg)_75%,transparent)]"
                        >
                            <Icon className="size-4 text-fg" name={'chevron-forward'} />
                        </IconButton>
                        <div className="absolute bottom-2.5 left-1/2 z-[2] flex -translate-x-1/2 gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-bg)_45%,transparent)] px-2.5 py-1.5 backdrop-blur-[4px]">
                            {slides.map((slide, index) => (
                                <button
                                    key={index}
                                    type={'button'}
                                    aria-label={slide.type === 'video' ? 'Trailer' : 'Image'}
                                    onClick={() => setActive(index)}
                                    className={cn(
                                        'h-[0.4rem] cursor-pointer rounded-full border-0 p-0 transition-[background-color,width] duration-150',
                                        slide.type === 'video' ? 'w-3' : 'w-[0.4rem]',
                                        index === active ? 'bg-accent' : 'bg-white/35 hover:bg-white/60',
                                    )}
                                />
                            ))}
                        </div>
                    </React.Fragment>
                    :
                    null
            }
        </div>
    );
};

export default HeroMedia;
