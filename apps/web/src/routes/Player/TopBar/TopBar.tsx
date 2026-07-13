// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Player top overlay bar (back / title / HDR badge). Clean-room replacement for
 * the shared HorizontalNavBar usage the Player route used to import from - this
 * ENDS the CSS-module `:import` coupling to NavBar/HorizontalNavBar styles.less.
 *
 * The gradient scrim, positioning and immersion fade live on the Player's own
 * `.nav-bar-layer` (styles.less); this component only paints the bar contents.
 * Window controls (min/max/close) are app-global (WindowControls), NOT here.
 */

import React, { forwardRef } from 'react';
import { useNavigate } from 'react-router';
import Icon from '@stremio/stremio-icons/react';
import { useIsShell } from 'rillio/components/WindowControls/WindowControls';
import { useHorizontalNavGamepadNavigation } from 'rillio/services/GamepadNavigation';
import { IconButton } from 'rillio/components/ui';

type HdrInfo = { gamma?: string } | null | undefined;

type Props = {
    className?: string;
    title?: string | null;
    hdrInfo?: HdrInfo;
    onMouseMove?: (event: React.MouseEvent) => void;
    onMouseOver?: (event: React.MouseEvent) => void;
};

// Stable gamepad-handler id so buttonB=back / buttonY=fullscreen keep working,
// exactly as the old HorizontalNavBar registered them for the player.
const GAMEPAD_HANDLER_ID = 'player-top-bar';

const TopBar = forwardRef<HTMLElement, Props>(function TopBar({ className, title, hdrInfo, onMouseMove, onMouseOver }, ref) {
    const navigate = useNavigate();
    const shell = useIsShell();
    // Frameless shell: the bar itself is a window drag handle (the attribute only
    // fires on the elements that carry it, so the button stays clickable).
    const dragProps = shell ? { 'data-tauri-drag-region': '' } : {};

    useHorizontalNavGamepadNavigation(GAMEPAD_HANDLER_ID, true);

    const onBack = React.useCallback(() => {
        navigate(-1);
    }, [navigate]);

    const showHdr = hdrInfo != null && (hdrInfo.gamma === 'pq' || hdrInfo.gamma === 'hlg');

    return (
        <nav
            ref={ref}
            {...dragProps}
            onMouseMove={onMouseMove}
            onMouseOver={onMouseOver}
            className={`flex flex-row items-center gap-2 pl-4 pr-6 pt-[var(--safe-area-inset-top)] ${className ?? ''}`}
        >
            <IconButton
                tabIndex={-1}
                title="Back"
                aria-label="Back"
                onClick={onBack}
                className="opacity-100 text-fg"
            >
                <Icon name="chevron-back" className="size-4" />
            </IconButton>
            {
                typeof title === 'string' && title.length > 0 ?
                    <h2
                        {...dragProps}
                        className="flex-1 truncate px-2 text-lg font-semibold tracking-[0.01em] text-fg"
                    >
                        {title}
                    </h2>
                    :
                    <div className="flex-1" />
            }
            {
                showHdr ?
                    <div
                        className="flex h-10 select-none items-center justify-center px-2 text-fg-muted"
                        title={hdrInfo!.gamma === 'pq' ? 'HDR10' : 'HLG'}
                    >
                        <Icon name="hdr" className="h-4 w-8" />
                    </div>
                    :
                    null
            }
        </nav>
    );
});

export default TopBar;
