// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Primary desktop nav bar for the main routes (Home / Discover / Library /
 * Calendar). Clean-room rewrite onto the foundation kit: the account hub is the
 * kit Popover (via NavMenu), search is a URL-driven modal route (a <Link>, not
 * internal state, per decisions.md #7), and the cached-downloads badge is anchored
 * to the glyph with no overflow-hidden ancestor so it is never clipped.
 *
 * Frameless shell: the <nav> and its flex spacer carry data-tauri-drag-region so
 * the bar drags the window; the links/buttons never do, so they stay clickable.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import LogoMark from 'rillio/common/LogoMark/LogoMark';
import useActiveDownloads from 'rillio/common/useActiveDownloads';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import { useIsShell } from 'rillio/components/WindowControls/WindowControls';
import { SEARCH_MODAL_PATH } from 'rillio/components/SearchModal';
import NavMenu from 'rillio/components/NavBar/HorizontalNavBar/NavMenu';

type Tab = { id: string; label: string; href: string };

// Addons + Settings intentionally live in the Account hub (NavMenuContent), not here.
const TABS: Tab[] = [
    { id: 'board', label: 'Home', href: '/' },
    { id: 'discover', label: 'Discover', href: '/discover' },
    { id: 'library', label: 'Library', href: '/library' },
    { id: 'calendar', label: 'Calendar', href: '/calendar' },
];

// Account keeps its island chip; search + addons are bare icons.
const ICON_BUTTON = 'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface/70 backdrop-blur transition-colors duration-150';
const ICON_BUTTON_BARE = 'inline-flex size-10 shrink-0 items-center justify-center overflow-visible rounded-full transition-colors duration-150';

type Props = {
    className?: string;
    route?: string;
};

const TopNav = ({ className, route }: Props) => {
    const { t } = useTranslation();
    // In the frameless desktop shell the nav doubles as the window drag handle:
    // the bar and its empty spacer are drag regions, while the links/buttons
    // (never tagged) stay clickable. `shell` is false in the browser build.
    const shell = useIsShell();
    const dragProps = shell ? { 'data-tauri-drag-region': '' } : {};
    const activeId = route === 'continue_watching' ? 'library' : route;
    // Pulsing dot on the Cached button while anything is downloading.
    const downloading = useActiveDownloads();
    const brandRef = React.useRef<HTMLAnchorElement>(null);

    // NavMenu (kit Popover) wraps this in a PopoverTrigger asChild, so Radix injects
    // the trigger ref/handlers/aria; we only style the island chip and reflect the
    // open state. The kit Button (renders a <div>) can legally host the menu chip.
    const renderAccountLabel = React.useCallback(({ active }: { active: boolean }) => (
        <Button
            title={t('Account')}
            className={cn(ICON_BUTTON, active ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
        >
            <Icon className="size-4" name="person-outline" />
        </Button>
    ), [t]);

    return (
        <nav {...dragProps} className={cn('flex items-center gap-5 h-full px-6 overflow-visible', className)}>
            <Link ref={brandRef} to="/" title="Rillio" tabIndex={-1} className="group flex items-center gap-2.5 shrink-0">
                <LogoMark className="h-8" hoverRef={brandRef} />
                {/* Visible at rest; on brand hover it re-fades in (a quick dip
                    then back), timed with the mark's fluid pour. */}
                <span className="hidden text-lg font-semibold tracking-tight text-fg group-hover:animate-[rillio-wordmark-fade_0.5s_var(--ease-smooth)] sm:block">Rillio</span>
            </Link>

            <div className="flex items-center gap-1 shrink-0">
                {TABS.map((tab) => {
                    const selected = tab.id === activeId;
                    return (
                        <Link
                            key={tab.id}
                            to={tab.href}
                            tabIndex={-1}
                            className={cn(
                                'inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors duration-150',
                                selected ? 'text-accent' : 'text-fg-muted hover:text-fg'
                            )}
                        >
                            {t(tab.label)}
                        </Link>
                    );
                })}
            </div>

            <div {...dragProps} className="flex-1" />

            <div className="flex shrink-0 items-center gap-2 overflow-visible">
                <Link
                    to={SEARCH_MODAL_PATH}
                    title={t('SEARCH')}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON_BARE, 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="search" />
                </Link>
                <Link
                    to="/addons"
                    title={t('ADDONS')}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON_BARE, route === 'addons' ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="addons-outline" />
                </Link>
                <Link
                    to="/cached"
                    title={'Cached'}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON_BARE, route === 'cached' ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    {/* The dot anchors to the glyph and is intentionally NOT inside
                        any overflow-hidden box, so it is never clipped. */}
                    <span className="relative overflow-visible">
                        <Icon className="size-4" name="download" />
                        {
                            downloading ?
                                <span className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-accent" />
                                :
                                null
                        }
                    </span>
                </Link>
                <Link
                    to="/settings"
                    title={t('SETTINGS')}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON_BARE, route === 'settings' ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="settings" />
                </Link>
                <NavMenu renderLabel={renderAccountLabel} />
            </div>
        </nav>
    );
};

export default TopNav;
