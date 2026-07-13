// Copyright (C) 2017-2026 Smart code 203358507

/**
 * ContextMenu - a faithful custom right-click menu, ported to .tsx/Tailwind.
 *
 * Why NOT the kit's Radix ContextMenu: this component's two Player call sites depend
 * on behavior Radix cannot express without a leaky adaptation:
 *   - a MULTI-ref trigger (`on: ref[]`): the right-click-over-video menu arms three
 *     dynamic sibling layers at once (video surface / buffering / error overlay), only
 *     one of which is mounted at a time. Radix `ContextMenuTrigger` wraps a single
 *     element, so this would require a virtual-anchor hook re-attaching `contextmenu`
 *     to each ref and driving a DropdownMenu at a synthetic cursor anchor.
 *   - `lock`-to-edge anchoring: the SubtitleVariant menu opens flush to an element
 *     EDGE (not the cursor). Radix ContextMenu always positions at the cursor, so this
 *     too would mean hand-wiring a controlled DropdownMenu with a virtual anchor.
 * Rebuilding both on Radix reimplements exactly the collision-aware positioning this
 * file already does cleanly, while adding a portal + focus-trap that could fight the
 * Player immersion / closePrevented contract. Per the mandate, a faithful custom port
 * beats a leaky Radix adaptation, so the custom positioning stays; only its hashed
 * CSS-module classes (now Tailwind) and the legacy `Transition` (now the motion
 * `Presence` fade) are replaced.
 */

import React, { memo, RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Presence from '../Presence';

const PADDING = 8;

type Coordinates = [number, number];
type Size = [number, number];
type Lock = 'top' | 'right' | 'bottom' | 'left';

type Props = {
    children: React.ReactNode,
    on: RefObject<HTMLElement>[],
    autoClose: boolean,
    lock?: Lock,
};

const ContextMenu = ({ children, on, autoClose, lock }: Props) => {
    const [active, setActive] = useState(false);
    const [position, setPosition] = useState<Coordinates>([0, 0]);
    const [containerSize, setContainerSize] = useState<Size>([0, 0]);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

    const ref = useCallback((element: HTMLDivElement) => {
        element && setContainerSize([element.offsetWidth, element.offsetHeight]);
    }, []);

    const style = useMemo(() => {
        const [viewportWidth, viewportHeight] = [window.innerWidth, window.innerHeight];
        const [containerWidth, containerHeight] = containerSize;

        let x: number;
        let y: number;

        if (lock && triggerRect) {
            switch (lock) {
                case 'top':
                    x = triggerRect.left;
                    y = triggerRect.top - containerHeight;
                    break;
                case 'bottom':
                    x = triggerRect.left;
                    y = triggerRect.bottom;
                    break;
                case 'left':
                    x = triggerRect.left - containerWidth;
                    y = triggerRect.top;
                    break;
                case 'right':
                    x = triggerRect.right;
                    y = triggerRect.top;
                    break;
            }
        } else {
            [x, y] = position;
        }

        const left = Math.max(
            PADDING,
            Math.min(
                x + containerWidth > viewportWidth - PADDING ? x - containerWidth : x,
                viewportWidth - containerWidth - PADDING
            )
        );

        const top = Math.max(
            PADDING,
            Math.min(
                y + containerHeight > viewportHeight - PADDING ? y - containerHeight : y,
                viewportHeight - containerHeight - PADDING
            )
        );

        return { top, left };
    }, [position, containerSize, lock, triggerRect]);

    const close = () => {
        setActive(false);
    };

    const stopPropagation = (event: React.MouseEvent | React.TouchEvent) => {
        event.stopPropagation();
    };

    const onContextMenu = useCallback((event: MouseEvent) => {
        event.preventDefault();

        if (lock) {
            const target = event.currentTarget as HTMLElement;
            setTriggerRect(target.getBoundingClientRect());
        } else {
            setPosition([event.clientX, event.clientY]);
        }
        setActive(true);
    }, [lock]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => event.key === 'Escape' && close(), []);

    const onClick = useCallback(() => {
        autoClose && close();
    }, [autoClose]);

    useEffect(() => {
        on.forEach((ref) => ref.current && ref.current.addEventListener('contextmenu', onContextMenu));
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            on.forEach((ref) => ref.current && ref.current.removeEventListener('contextmenu', onContextMenu));
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [on, onContextMenu, handleKeyDown]);

    return createPortal((
        <Presence when={active}>
            <div
                className={'fixed inset-0'}
                onMouseDown={close}
                onTouchStart={close}
            >
                <div
                    ref={ref}
                    className={'fixed rounded-(--border-radius) bg-(--modal-background-color) shadow-(--outer-glow)'}
                    style={style}
                    onMouseDown={stopPropagation}
                    onTouchStart={stopPropagation}
                    onClick={onClick}
                >
                    {children}
                </div>
            </div>
        </Presence>
    ), document.body);
};

export default memo(ContextMenu);
