// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Tooltip (foundation kit) - Radix Tooltip + one TooltipProvider at app root.
 * Portaled, collision-aware, hover + focus + touch + keyboard, with aria-describedby
 * for free. The <Tooltip> convenience wrapper keeps the app's "drop a label on an
 * element, auto-attach to it" DX by wrapping children in a TooltipTrigger asChild.
 */

import React, { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from './cn';

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
    ElementRef<typeof TooltipPrimitive.Content>,
    ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 4, ...props }, ref) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    // Floating glass, same family as the menus: black-alpha bg-popover +
                    // the glass blur token + border-line, so the tip stays legible over any
                    // backdrop (a white-lift chip would wash out over bright imagery).
                    'z-50 max-w-xs rounded-card border border-line bg-popover px-2.5 py-1.5 text-xs text-fg shadow-elevated backdrop-blur-(--glass-blur)',
                    'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
                    className,
                )}
                {...props}
            />
        </TooltipPrimitive.Portal>
    );
});

export type TooltipProps = {
    /** The tooltip body. When empty/nullish the children render untooltipped. */
    label?: ReactNode;
    children: ReactNode;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    delayDuration?: number;
    contentClassName?: string;
};

/**
 * Tooltip - the ergonomic wrapper. Drop it around any element and give it a label;
 * it attaches to that element (TooltipTrigger asChild). Expects a TooltipProvider
 * somewhere above (mounted once at app root).
 */
export function Tooltip({ label, children, side = 'top', align = 'center', sideOffset, delayDuration, contentClassName }: TooltipProps) {
    if (label == null || label === '') {
        return <>{children}</>;
    }
    return (
        <TooltipRoot delayDuration={delayDuration}>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side={side} align={align} sideOffset={sideOffset} className={contentClassName}>
                {label}
            </TooltipContent>
        </TooltipRoot>
    );
}

export default Tooltip;
