// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Popover (foundation kit) - Radix Popover for arbitrary anchored content (as
 * opposed to DropdownMenu, which is for action lists). Portals to body with
 * collision handling. Combobox-style call sites (LanguagePicker) pair this with the
 * Command primitive.
 */

import React, { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from './cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
    ElementRef<typeof PopoverPrimitive.Content>,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = 'center', sideOffset = 4, ...props }, ref) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={ref}
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    // Cinematic glass: black-alpha bg-popover + the glass blur token, with a
                    // border-line hairline so the panel reads over the pure-black page.
                    'z-50 w-72 rounded-card border border-line bg-popover p-4 text-popover-foreground shadow-elevated outline-none backdrop-blur-(--glass-blur) transition-none',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});

export default Popover;
