// Copyright (C) 2017-2024 Smart code 203358507

/**
 * DropdownMenu (foundation kit) - Radix DropdownMenu adapted to our flat, borderless
 * look: divide-free action list, neutral (accent = surface-hover) item hover, brand
 * accent dot / checkmark indicators, lucide-react for chevrons and checks. Portals
 * to body with collision handling, so every hand-rolled getBoundingClientRect flip
 * retires. Use for action lists; use Popover for arbitrary anchored content.
 */

import React, { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { ChevronRight, Check } from 'lucide-react';
import { cn } from './cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const contentClasses =
    // transition-none guards the Radix popper transform from ever ANIMATING to its
    // computed position (which would read as a snap/jump on open or on the first
    // hover-triggered reposition). Entrance/exit here are `animation` utilities
    // (animate-in / zoom), not transitions, so they are unaffected.
    // Cinematic glass: black-alpha bg-popover + the glass blur token darkens/frosts the
    // content behind (the player-island recipe); the border-line hairline defines the
    // panel edge over the pure-black page, where the translucent fill alone vanishes.
    'z-50 min-w-[10rem] overflow-hidden rounded-card border border-line bg-popover p-1 text-popover-foreground shadow-elevated backdrop-blur-(--glass-blur) transition-none ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';

const itemClasses =
    'relative flex cursor-pointer select-none items-center gap-2 rounded-[calc(var(--radius-card)-0.25rem)] px-2 py-1.5 text-sm outline-none transition-colors ' +
    'focus:bg-surface-hover focus:text-fg data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-(--icon-size) [&_svg]:shrink-0';

export const DropdownMenuSubTrigger = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }
>(function DropdownMenuSubTrigger({ className, inset, children, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.SubTrigger
            ref={ref}
            className={cn(itemClasses, 'data-[state=open]:bg-surface-hover', inset && 'pl-8', className)}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto size-4" />
        </DropdownMenuPrimitive.SubTrigger>
    );
});

export const DropdownMenuSubContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.SubContent>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
    return <DropdownMenuPrimitive.SubContent ref={ref} className={cn(contentClasses, className)} {...props} />;
});

export const DropdownMenuContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(contentClasses, className)}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
});

export const DropdownMenuItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Item>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(function DropdownMenuItem({ className, inset, ...props }, ref) {
    return <DropdownMenuPrimitive.Item ref={ref} className={cn(itemClasses, inset && 'pl-8', className)} {...props} />;
});

export const DropdownMenuCheckboxItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, checked, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.CheckboxItem
            ref={ref}
            className={cn(itemClasses, 'pl-8', className)}
            checked={checked}
            {...props}
        >
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="size-4 text-primary" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.CheckboxItem>
    );
});

export const DropdownMenuRadioItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(itemClasses, 'pl-8', className)} {...props}>
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <span className="size-2 rounded-full bg-primary" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.RadioItem>
    );
});

export const DropdownMenuLabel = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(function DropdownMenuLabel({ className, inset, ...props }, ref) {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn('px-2 py-1.5 text-xs font-semibold text-fg-muted', inset && 'pl-8', className)}
            {...props}
        />
    );
});

export const DropdownMenuSeparator = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
    return <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
});

export function DropdownMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
    return <span className={cn('ml-auto text-xs tracking-widest text-fg-subtle', className)} {...props} />;
}

export default DropdownMenu;
