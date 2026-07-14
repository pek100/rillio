// Copyright (C) 2017-2026 Smart code 203358507

/**
 * ContextMenu - right-click / edge-locked menu built on Radix Popover with a virtual
 * anchor. The public API ({ on, autoClose, lock, children }) is unchanged, so both call
 * sites (Player right-click OptionsMenu, SubtitleVariant lock='bottom') stay drop-in.
 *
 * A thin app-owned hook (useContextAnchor) attaches `contextmenu` to every ref in `on`
 * and feeds ONE virtual anchor into Popover.Anchor's `virtualRef` (a
 * { current: { getBoundingClientRect } } Measurable): a zero-size rect at the cursor for
 * the default case, the real element rect for the lock/edge case. Popper's flip/shift
 * collision logic (collisionPadding) replaces the old hand-rolled PADDING clamp, and
 * `lock` maps 1:1 to `side`.
 *
 * `virtualRef` is undocumented-but-stable: it is the exact mechanism Radix's own
 * ContextMenu uses to position at the cursor, so it will not be removed (verified in
 * @radix-ui/react-popper source: with a virtualRef, PopperAnchor renders null and
 * positions against virtualRef.current). If it ever were removed, the 2-line fallback is
 * a real, zero-size absolutely-positioned <Popover.Anchor> element moved to the cursor.
 *
 * Why Popover and not the kit ContextMenu/DropdownMenu: those wrap a single trigger and
 * position at the cursor only; this needs N dynamic sibling triggers plus edge-lock.
 * Why this is safe on the Player surface: the old component ALREADY portalled to body
 * (createPortal), and Popover.Portal preserves the identical React-tree relationship, so
 * OptionsMenu's `optionsMenuClosePrevented` mousedown still bubbles the React tree to
 * Player's onContainerMouseDown (the closePrevented protocol is untouched). `modal={false}`
 * (no focus trap / scroll lock / aria-hide) plus onOpenAutoFocus preventDefault keep the
 * app in charge of focus and immersion. DismissableLayer supplies Escape + outside-
 * pointerdown close, replacing the old full-screen overlay + document keydown listener.
 * Entrance/exit is the kit convention (data-state + tw-animate-css), replacing the old
 * motion Presence fade.
 */

import React, { memo, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

const PADDING = 8;

type Lock = 'top' | 'right' | 'bottom' | 'left';
type Measurable = { getBoundingClientRect: () => DOMRect };

type Props = {
    children: React.ReactNode,
    on: RefObject<HTMLElement>[],
    autoClose: boolean,
    lock?: Lock,
};

// A zero-size rect pinned at the cursor (the default, non-lock anchor).
const pointRect = (x: number, y: number): DOMRect =>
    ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;

// Attaches `contextmenu` to every ref in `on` and drives a virtual anchor + open state.
const useContextAnchor = (on: RefObject<HTMLElement>[], lock?: Lock) => {
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<Measurable>({ getBoundingClientRect: () => pointRect(0, 0) });
    // Radix's PopperAnchor effect re-reads virtualRef.current on every render and
    // repositions only when its object identity changes. Bump on each contextmenu so a
    // SECOND right-click (while already open, when setOpen(true) is a no-op) still forces
    // the effect to re-run and move the menu to the new cursor / edge.
    const [, bumpAnchor] = useState(0);

    const onContextMenu = useCallback((event: MouseEvent) => {
        event.preventDefault();
        const rect = lock
            ? (event.currentTarget as HTMLElement).getBoundingClientRect()
            : pointRect(event.clientX, event.clientY);
        anchorRef.current = { getBoundingClientRect: () => rect };
        setOpen(true);
        bumpAnchor((n) => n + 1);
    }, [lock]);

    useEffect(() => {
        on.forEach((ref) => ref.current && ref.current.addEventListener('contextmenu', onContextMenu));
        return () => {
            on.forEach((ref) => ref.current && ref.current.removeEventListener('contextmenu', onContextMenu));
        };
    }, [on, onContextMenu]);

    return { open, setOpen, anchorRef };
};

const ContextMenu = ({ children, on, autoClose, lock }: Props) => {
    const { open, setOpen, anchorRef } = useContextAnchor(on, lock);

    const onContentClick = useCallback(() => {
        autoClose && setOpen(false);
    }, [autoClose, setOpen]);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
            <PopoverPrimitive.Anchor virtualRef={anchorRef} />
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    side={lock ?? 'bottom'}
                    align={'start'}
                    sideOffset={0}
                    collisionPadding={PADDING}
                    // The app owns focus: never pull it into the menu (open) or shove it
                    // back to the null virtual anchor (close), either of which would jar
                    // the Player immersion.
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    onClick={onContentClick}
                    className={
                        // The house floating-menu material, identical to the kit's
                        // dropdown/select/popover content: glass-panel fill + a
                        // border-line hairline + shadow-elevated + the glass blur token.
                        'z-50 rounded-card border border-line bg-popover text-popover-foreground shadow-elevated backdrop-blur-(--glass-blur) transition-none ' +
                        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
                    }
                >
                    {children}
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
};

export default memo(ContextMenu);
