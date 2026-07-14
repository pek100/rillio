// Copyright (C) 2017-2024 Smart code 203358507

/**
 * ContextMenu (foundation kit) - Radix ContextMenu (right-click / long-press),
 * reusing the same flat action-list look as DropdownMenu. For lock-to-edge call
 * sites (open flush to an element edge, not the cursor) use DropdownMenu with a
 * `side=` instead; for the multi-trigger `on: ref[]` pattern, attach a virtual
 * cursor anchor and open a DropdownMenu.
 */

import React, { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { ChevronRight, Check } from 'lucide-react';
import { cn } from './cn';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const contentClasses =
    // transition-none: keep the Radix popper positioning instant (never animate the
    // transform to place). Entrance/exit are `animation` utilities, not transitions.
    // Cinematic glass: black-alpha bg-popover + the glass blur token, border-line hairline
    // edge (see dropdown-menu contentClasses for the full rationale).
    'z-50 min-w-[8rem] overflow-hidden rounded-card border border-line bg-popover p-1 text-popover-foreground shadow-elevated backdrop-blur-(--glass-blur) transition-none ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';

const itemClasses =
    'relative flex cursor-pointer select-none items-center gap-2 rounded-[calc(var(--radius-card)-0.25rem)] px-2 py-1.5 text-sm outline-none transition-colors ' +
    'focus:bg-surface-hover focus:text-fg data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-(--icon-size) [&_svg]:shrink-0';

export const ContextMenuSubTrigger = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }
>(function ContextMenuSubTrigger({ className, inset, children, ...props }, ref) {
    return (
        <ContextMenuPrimitive.SubTrigger
            ref={ref}
            className={cn(itemClasses, 'data-[state=open]:bg-surface-hover', inset && 'pl-8', className)}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto size-4" />
        </ContextMenuPrimitive.SubTrigger>
    );
});

export const ContextMenuSubContent = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.SubContent>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(function ContextMenuSubContent({ className, ...props }, ref) {
    return <ContextMenuPrimitive.SubContent ref={ref} className={cn(contentClasses, className)} {...props} />;
});

export const ContextMenuContent = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.Content>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content ref={ref} className={cn(contentClasses, className)} {...props} />
        </ContextMenuPrimitive.Portal>
    );
});

export const ContextMenuItem = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.Item>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { inset?: boolean }
>(function ContextMenuItem({ className, inset, ...props }, ref) {
    return <ContextMenuPrimitive.Item ref={ref} className={cn(itemClasses, inset && 'pl-8', className)} {...props} />;
});

export const ContextMenuCheckboxItem = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(function ContextMenuCheckboxItem({ className, children, checked, ...props }, ref) {
    return (
        <ContextMenuPrimitive.CheckboxItem ref={ref} className={cn(itemClasses, 'pl-8', className)} checked={checked} {...props}>
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <ContextMenuPrimitive.ItemIndicator>
                    <Check className="size-4 text-primary" />
                </ContextMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.CheckboxItem>
    );
});

export const ContextMenuRadioItem = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.RadioItem>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(function ContextMenuRadioItem({ className, children, ...props }, ref) {
    return (
        <ContextMenuPrimitive.RadioItem ref={ref} className={cn(itemClasses, 'pl-8', className)} {...props}>
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <ContextMenuPrimitive.ItemIndicator>
                    <span className="size-2 rounded-full bg-primary" />
                </ContextMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.RadioItem>
    );
});

export const ContextMenuLabel = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & { inset?: boolean }
>(function ContextMenuLabel({ className, inset, ...props }, ref) {
    return (
        <ContextMenuPrimitive.Label
            ref={ref}
            className={cn('px-2 py-1.5 text-xs font-semibold text-fg-muted', inset && 'pl-8', className)}
            {...props}
        />
    );
});

export const ContextMenuSeparator = forwardRef<
    ElementRef<typeof ContextMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
    return <ContextMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
});

export function ContextMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
    return <span className={cn('ml-auto text-xs tracking-widest text-fg-subtle', className)} {...props} />;
}

export default ContextMenu;
