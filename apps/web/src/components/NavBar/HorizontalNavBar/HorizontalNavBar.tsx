// Copyright (C) 2017-2024 Smart code 203358507

/**
 * HorizontalNavBar - the app-wide top nav bar wrapper used by the detail / player /
 * settings-adjacent routes (MetaDetails, NotFound). Clean-room rewrite onto the
 * foundation kit + Tailwind tokens (its styles.less is retired; the Player's old
 * CSS-module `:import` coupling ended in Wave C). The props contract is preserved
 * verbatim: drag region, back button (originPath-aware), title, SearchBar slot,
 * HDR-gamma indicator, and the NavMenu account hub.
 *
 * Frameless shell: the <nav> (and the title) carry data-tauri-drag-region so the bar
 * drags the window; the buttons / search never do, so they stay clickable.
 */

import React, { memo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import Icon from '@stremio/stremio-icons/react';
import Logo from 'rillio/common/Logo/Logo';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import { useIsShell } from 'rillio/components/WindowControls/WindowControls';
import { useHorizontalNavGamepadNavigation } from 'rillio/services/GamepadNavigation';
import SearchBar from './SearchBar';
import NavMenu from './NavMenu';

// 40px circular control with a size-4 glyph. Bare over the video/backdrop by
// default; hover/active gets the app's translucent over-imagery fill and the icon
// brightens muted -> fg, matching the legacy .button-container.
const NAV_BUTTON = 'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors duration-150 hover:bg-[var(--overlay-color)] hover:text-fg';

type HdrInfo = { gamma?: string };

type Props = {
    className?: string;
    route?: string;
    query?: string;
    title?: string;
    backButton?: boolean;
    searchBar?: boolean;
    fullscreenButton?: boolean;
    navMenu?: boolean;
    originPath?: string;
    hdrInfo?: HdrInfo;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>;

const HorizontalNavBar = memo(({ className, route, query, title, backButton, searchBar, fullscreenButton, navMenu, originPath, hdrInfo, ...props }: Props) => {
    const navigate = useNavigate();
    const backButtonOnClick = useCallback(() => {
        if (originPath) {
            navigate(originPath, { replace: true });
        } else {
            navigate(-1);
        }
    }, [originPath, navigate]);

    // Frameless shell: this navbar is a window drag handle, exactly like TopNav on
    // the main routes. The attribute only fires on the bar (and title) itself, so
    // buttons / search stay clickable.
    const shell = useIsShell();
    const dragProps = shell ? { 'data-tauri-drag-region': '' } : {};

    // NavMenu wraps this in a Radix PopoverTrigger (asChild), which injects the ref /
    // onClick / aria onto the Button; we only supply the chip visuals and the
    // open-state `active` highlight.
    const renderNavMenuLabel = useCallback(({ active }: { active: boolean }) => (
        <Button variant="ghost" className={cn(NAV_BUTTON, active && 'bg-[var(--overlay-color)] text-fg')} tabIndex={-1}>
            <Icon className="size-4" name="person-outline" />
        </Button>
    ), []);

    useHorizontalNavGamepadNavigation(route || className, backButton);

    return (
        <nav
            {...props}
            {...dragProps}
            className={cn(
                'box-content flex flex-row items-center justify-between overflow-visible bg-transparent pr-6 pt-[var(--safe-area-inset-top)] h-[var(--horizontal-nav-bar-size)] max-sm:pr-0',
                className,
            )}
        >
            {
                backButton ?
                    <Button
                        variant="ghost"
                        className={cn(NAV_BUTTON, 'ml-[max(0rem,calc(1rem-var(--safe-area-inset-left)))] max-sm:mx-4')}
                        tabIndex={-1}
                        onClick={backButtonOnClick}
                    >
                        <Icon className="size-4" name="chevron-back" />
                    </Button>
                    :
                    <div className="flex flex-none items-center justify-center w-[var(--vertical-nav-bar-size)] h-[var(--horizontal-nav-bar-size)] max-sm:w-[var(--horizontal-nav-bar-size)]">
                        <Logo className="h-8 w-auto" />
                    </div>
            }
            {
                typeof title === 'string' && title.length > 0 ?
                    <h2 {...dragProps} className="flex-[4_0_0] overflow-hidden text-ellipsis whitespace-nowrap px-4 text-[1.125rem] font-semibold tracking-[0.01rem] text-fg">{title}</h2>
                    :
                    null
            }
            {
                searchBar && route !== 'addons' ?
                    <SearchBar className="h-10 w-96" query={query} active={route === 'search'} />
                    :
                    null
            }
            <div className="flex flex-row items-center gap-2 overflow-visible">
                {
                    hdrInfo && (hdrInfo.gamma === 'pq' || hdrInfo.gamma === 'hlg') ?
                        <div className="flex flex-none select-none items-center justify-center h-10 px-2" title={hdrInfo.gamma === 'pq' ? 'HDR10' : 'HLG'}>
                            <Icon className="h-4 w-8 text-fg-muted" name="hdr" />
                        </div>
                        :
                        null
                }
                {
                    navMenu ?
                        <NavMenu renderLabel={renderNavMenuLabel} />
                        :
                        null
                }
            </div>
        </nav>
    );
});

HorizontalNavBar.displayName = 'HorizontalNavBar';

export default HorizontalNavBar;
