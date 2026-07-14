// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Sheet (foundation kit) - a Radix Dialog based edge panel. The Player SideDrawer
 * uses `side=right` with `modal={false}` (decisions.md #6): no scrim, no focus trap,
 * so the playing video stays fully interactive underneath. Controlled `open` from
 * state/URL; the custom edge-tab trigger (SideDrawerButton) lives at the call site.
 *
 * When modal is false the overlay is not rendered (an overlay would eat pointer
 * events over the video); when true it behaves like a normal focus-trapped sheet.
 */

import React, { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from './cn';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = forwardRef<
    ElementRef<typeof SheetPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
    return (
        <SheetPrimitive.Overlay
            ref={ref}
            className={cn(
                'fixed inset-0 z-50 bg-black/60 backdrop-blur-(--scrim-blur)',
                'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                className,
            )}
            {...props}
        />
    );
});

const sheetVariants = cva(
    // The house glass material: dark translucent fill + a border-line hairline +
    // shadow-elevated + the glass blur token. The panel carries the blur itself
    // (unlike Dialog, whose scrim carries it) because this primitive's only
    // consumer, the Player SideDrawer, runs `overlay={false}` over live video and
    // so has no scrim to blur for it.
    'fixed z-50 flex flex-col gap-4 border border-line bg-card text-card-foreground shadow-elevated backdrop-blur-(--glass-blur) transition ease-in-out ' +
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-300',
    {
        variants: {
            side: {
                top: 'inset-x-0 top-0 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
                bottom: 'inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
                left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
                right: 'inset-y-0 right-0 h-full w-3/4 max-w-sm data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            },
        },
        defaultVariants: { side: 'right' },
    },
);

type SheetContentProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Content> &
    VariantProps<typeof sheetVariants> & {
        /** Render the dimming overlay. Pass false for modal={false} side panels over video. */
        overlay?: boolean;
        showClose?: boolean;
    };

export const SheetContent = forwardRef<ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
    function SheetContent({ side = 'right', className, children, overlay = true, showClose = true, ...props }, ref) {
        return (
            <SheetPortal>
                {overlay ? <SheetOverlay /> : null}
                <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), 'p-6', className)} {...props}>
                    {children}
                    {showClose ? (
                        <SheetPrimitive.Close
                            className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full text-fg-muted opacity-70 outline-none transition hover:bg-surface-hover hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight"
                            aria-label="Close"
                        >
                            <X className="size-4" />
                        </SheetPrimitive.Close>
                    ) : null}
                </SheetPrimitive.Content>
            </SheetPortal>
        );
    },
);

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('mt-auto flex flex-col gap-2', className)} {...props} />;
}

export const SheetTitle = forwardRef<
    ElementRef<typeof SheetPrimitive.Title>,
    ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
    return <SheetPrimitive.Title ref={ref} className={cn('text-lg font-bold', className)} {...props} />;
});

export const SheetDescription = forwardRef<
    ElementRef<typeof SheetPrimitive.Description>,
    ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
    return <SheetPrimitive.Description ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />;
});

export default Sheet;
