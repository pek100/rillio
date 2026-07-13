// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Layout wrapper for the main routes: TopNav floated over a scrolling content pane,
 * respecting safe-area insets. Clean-room rewrite of MainNavBars.less onto Tailwind
 * (arbitrary values on the same layout tokens). Pure glue - no visible surface of its
 * own; the 0.5rem gap above the nav is preserved. Gamepad wiring reused verbatim.
 */

import React, { memo } from 'react';
import { cn } from 'rillio/components/ui/cn';
import TopNav from 'rillio/components/TopNav/TopNav';
import { useContentGamepadNavigation } from 'rillio/services/GamepadNavigation';

type Props = {
    className?: string,
    route?: string,
    query?: string,
    children?: React.ReactNode,
};

const MainNavBars = memo(({ className, route, children }: Props) => {
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
            <TopNav
                className="absolute inset-x-0 top-2 z-[1] h-[var(--horizontal-nav-bar-size)]"
                route={route}
            />
            <div
                ref={contentRef}
                className="absolute inset-x-0 bottom-0 z-0 overflow-hidden top-[calc(var(--horizontal-nav-bar-size)+0.5rem+var(--safe-area-inset-top))]"
            >
                {children}
            </div>
        </div>
    );
});

MainNavBars.displayName = 'MainNavBars';

export default MainNavBars;
