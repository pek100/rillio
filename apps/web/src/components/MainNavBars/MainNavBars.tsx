// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Layout wrapper for the main routes: TopNav floated over a scrolling content pane,
 * respecting safe-area insets. Clean-room rewrite of MainNavBars.less onto Tailwind
 * (arbitrary values on the same layout tokens). The 0.5rem gap above the nav is
 * preserved. Gamepad wiring reused verbatim.
 *
 * The one visible surface it owns: the nav glow, a soft fall of the brand's old
 * blue-black from behind the nav into the pure-black page (a hint of the former
 * palette on the cinematic base). It lives here so it spans the main browse routes
 * only: MetaDetails paints its own backdrop art, and the Player is video.
 */

import React, { memo } from 'react';
import { cn } from 'rillio/components/ui/cn';
import TopNav from 'rillio/components/TopNav/TopNav';
import { useContentGamepadNavigation } from 'rillio/services/GamepadNavigation';

type Props = {
    className?: string,
    route?: string,
    query?: string,
    // Full-bleed: the content pane starts at the WINDOW top and scrolls under
    // the floating nav, for routes whose first element is edge-to-edge art
    // (the Board's hero). Everyone else keeps the classic below-the-nav pane.
    fullBleed?: boolean,
    // With fullBleed, rows eventually scroll under the transparent nav and its
    // labels land on poster art. The route watches its own scroll position and
    // raises this to fade in a dark scrim behind the nav.
    navScrim?: boolean,
    children?: React.ReactNode,
};

const MainNavBars = memo(({ className, route, fullBleed, navScrim, children }: Props) => {
    const contentRef = React.useRef(null);

    const navRoute = route === 'continue_watching' ? 'library' : (route ?? '');
    useContentGamepadNavigation(contentRef, navRoute);

    return (
        <div
            className={cn(
                'relative z-0 h-full overflow-clip',
                'ml-[var(--safe-area-inset-left)] mr-[var(--safe-area-inset-right)]',
                'w-[calc(100%-var(--safe-area-inset-left)-var(--safe-area-inset-right))]',
                className,
            )}
        >
            {/* Nav glow: sits under both the nav and the content (-z-10 against this
                wrapper's own stacking context), so it tints the page top without ever
                catching pointer events or washing the posters. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[linear-gradient(to_bottom,var(--color-nav-glow)_0%,color-mix(in_srgb,var(--color-nav-glow)_55%,transparent)_28%,transparent_100%)]"
            />
            {/* Scrolled-state scrim: a black fade behind the nav that keeps its
                labels readable once full-bleed content passes underneath. Rendered
                (and faded) above the content, below the nav itself. */}
            <div
                aria-hidden
                className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 z-[1] h-[calc(var(--horizontal-nav-bar-size)+var(--nav-top-gap)+2rem)]',
                    'bg-[linear-gradient(to_bottom,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.72)_60%,transparent_100%)]',
                    'transition-opacity duration-300',
                    navScrim ? 'opacity-100' : 'opacity-0',
                )}
            />
            <TopNav
                className="absolute inset-x-0 top-(--nav-top-gap) z-[1] h-[var(--horizontal-nav-bar-size)]"
                route={route}
            />
            <div
                ref={contentRef}
                className={cn(
                    'absolute inset-x-0 bottom-0 z-0 overflow-hidden',
                    fullBleed ? 'top-0' : 'top-[calc(var(--horizontal-nav-bar-size)+var(--nav-top-gap)+var(--safe-area-inset-top))]',
                )}
            >
                {children}
            </div>
        </div>
    );
});

MainNavBars.displayName = 'MainNavBars';

export default MainNavBars;
