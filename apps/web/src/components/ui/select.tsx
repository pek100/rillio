// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Select (foundation kit) - Radix Select re-skinned to a rounded-full pill trigger
 * with a brand accent-dot indicator on the selected row. Portals to body (fixing the
 * overflow-clip anchoring hacks StreamsList/Discover hand-rolled) and handles mobile
 * scroll-lock. Collapses the two legacy dropdown lineages (Multiselect popup/modal +
 * MultiselectMenu drill-in) into one primitive.
 *
 * The drill-in / Back "cascade" the legacy MultiselectMenu had is NOT a Radix idiom,
 * so it ships as an OPTIONAL mode: SelectCascade, custom `level` push/pop state on a
 * Popover + Button rows. Type-ahead cases use the Combobox pattern (Popover + Command)
 * instead; genuinely multi-value cases use DropdownMenu checkbox items or ToggleGroup.
 */

import React, { forwardRef, useMemo, useState, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
    ElementRef<typeof SelectPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
    return (
        <SelectPrimitive.Trigger
            ref={ref}
            className={cn(
                'inline-flex h-9 items-center justify-between gap-2 rounded-full bg-surface-hover px-3.5 text-sm text-fg outline-none',
                'data-[placeholder]:text-fg-subtle hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-(--icon-size) [&_svg]:shrink-0',
                className,
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDown className="size-4 opacity-60" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
});

export const SelectContent = forwardRef<
    ElementRef<typeof SelectPrimitive.Content>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                ref={ref}
                position={position}
                className={cn(
                    // transition-none keeps the popper positioning instant (no snap to
                    // place on open / reposition); the animate-in/zoom below are
                    // `animation` utilities, not transitions, so they still run.
                    // Cinematic glass: black-alpha bg-popover + the glass blur token, border-line
                    // hairline edge (see dropdown-menu contentClasses for the rationale).
                    'relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-hidden rounded-card border border-line bg-popover text-popover-foreground shadow-elevated backdrop-blur-(--glass-blur) transition-none',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
                    className,
                )}
                {...props}
            >
                <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center">
                    <ChevronUp className="size-4" />
                </SelectPrimitive.ScrollUpButton>
                <SelectPrimitive.Viewport
                    className={cn('p-1', position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]')}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center">
                    <ChevronDown className="size-4" />
                </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
});

export const SelectLabel = forwardRef<
    ElementRef<typeof SelectPrimitive.Label>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
    return <SelectPrimitive.Label ref={ref} className={cn('px-2 py-1.5 text-xs font-semibold text-fg-muted', className)} {...props} />;
});

export const SelectItem = forwardRef<
    ElementRef<typeof SelectPrimitive.Item>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
    return (
        <SelectPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex w-full cursor-pointer select-none items-center rounded-[calc(var(--radius-card)-0.25rem)] py-1.5 pl-8 pr-2 text-sm outline-none',
                'focus:bg-surface-hover focus:text-fg data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className,
            )}
            {...props}
        >
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <span className="size-2 rounded-full bg-primary" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
});

export const SelectSeparator = forwardRef<
    ElementRef<typeof SelectPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
    return <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
});

// --- Optional cascade (drill-in + Back) mode ---------------------------------

export type CascadeOption = {
    value: string;
    label: ReactNode;
    /** Present -> selecting this option drills into a nested level instead of committing. */
    options?: CascadeOption[];
};

export type SelectCascadeProps = {
    options: CascadeOption[];
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: ReactNode;
    className?: string;
    contentClassName?: string;
    disabled?: boolean;
};

type CascadeLevel = { title: ReactNode; options: CascadeOption[] };

/**
 * SelectCascade - a drill-in select. Each option with nested `options` pushes a new
 * level with a Back row; leaf options commit and close. This is the custom `level`
 * push/pop the legacy MultiselectMenu owned, rebuilt on Popover + Button rows (Radix
 * Select cannot express it). Single-value only.
 */
export function SelectCascade({ options, value, onValueChange, placeholder, className, contentClassName, disabled }: SelectCascadeProps) {
    const [open, setOpen] = useState(false);
    const [stack, setStack] = useState<CascadeLevel[]>([]);

    const current = stack.length > 0 ? stack[stack.length - 1] : { title: null as ReactNode, options };

    const selectedLabel = useMemo(() => {
        const find = (opts: CascadeOption[]): ReactNode => {
            for (const opt of opts) {
                if (opt.value === value) return opt.label;
                if (opt.options) {
                    const nested = find(opt.options);
                    if (nested != null) return nested;
                }
            }
            return null;
        };
        return find(options);
    }, [options, value]);

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setStack([]); }}>
            <PopoverTrigger
                disabled={disabled}
                className={cn(
                    'inline-flex h-9 items-center justify-between gap-2 rounded-full bg-surface-hover px-3.5 text-sm text-fg outline-none',
                    'hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight disabled:pointer-events-none disabled:opacity-50',
                    className,
                )}
            >
                <span className={cn(selectedLabel == null && 'text-fg-subtle')}>{selectedLabel ?? placeholder}</span>
                <ChevronDown className="size-4 shrink-0 opacity-60" />
            </PopoverTrigger>
            <PopoverContent align="start" className={cn('w-56 p-1', contentClassName)}>
                {stack.length > 0 ? (
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-[calc(var(--radius-card)-0.25rem)] px-2 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-hover"
                        onClick={() => setStack((s) => s.slice(0, -1))}
                    >
                        <ChevronLeft className="size-4" />
                        {current.title}
                    </button>
                ) : null}
                {current.options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-[calc(var(--radius-card)-0.25rem)] px-2 py-1.5 text-sm outline-none hover:bg-surface-hover',
                            opt.value === value && 'text-primary',
                        )}
                        onClick={() => {
                            if (opt.options && opt.options.length > 0) {
                                setStack((s) => [...s, { title: opt.label, options: opt.options! }]);
                            } else {
                                onValueChange?.(opt.value);
                                setOpen(false);
                                setStack([]);
                            }
                        }}
                    >
                        <span>{opt.label}</span>
                        {opt.options && opt.options.length > 0 ? <ChevronRight className="size-4 opacity-60" /> : null}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}

export default Select;
