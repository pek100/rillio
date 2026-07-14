// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Drawer (foundation kit) - vaul-backed bottom sheet. Native swipe / drag-dismiss +
 * velocity-threshold snap replace the manual touchmove / translateY logic. Controlled
 * `open` from state or the URL. Call sites keep the mobile-only media-query gate and
 * the useOrientation force-close-on-rotate.
 */

import React, { forwardRef, type ComponentProps, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from './cn';

export function Drawer({ shouldScaleBackground = true, ...props }: ComponentProps<typeof DrawerPrimitive.Root>) {
    return <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />;
}

export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerPortal = DrawerPrimitive.Portal;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerNested = DrawerPrimitive.NestedRoot;

export const DrawerOverlay = forwardRef<
    ElementRef<typeof DrawerPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(function DrawerOverlay({ className, ...props }, ref) {
    return <DrawerPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/60 backdrop-blur-(--scrim-blur)', className)} {...props} />;
});

export const DrawerContent = forwardRef<
    ElementRef<typeof DrawerPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(function DrawerContent({ className, children, ...props }, ref) {
    return (
        <DrawerPortal>
            <DrawerOverlay />
            <DrawerPrimitive.Content
                ref={ref}
                className={cn(
                    // Same recipe as Dialog: the vaul overlay carries the scrim blur, so
                    // NO backdrop-blur here (one blur per stacking context). Dark
                    // translucent bg-card + shadow-elevated + a border-line top edge.
                    'fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-squircle border-t border-line bg-card text-card-foreground shadow-elevated',
                    className,
                )}
                {...props}
            >
                <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-line" />
                {children}
            </DrawerPrimitive.Content>
        </DrawerPortal>
    );
});

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('grid gap-1.5 p-4 text-center sm:text-left', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

export const DrawerTitle = forwardRef<
    ElementRef<typeof DrawerPrimitive.Title>,
    ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
    return <DrawerPrimitive.Title ref={ref} className={cn('text-lg font-bold leading-tight', className)} {...props} />;
});

export const DrawerDescription = forwardRef<
    ElementRef<typeof DrawerPrimitive.Description>,
    ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
    return <DrawerPrimitive.Description ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />;
});

export default Drawer;
