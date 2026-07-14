// Copyright (C) 2017-2025 Smart code 203358507

/**
 * ActionsGroup - a horizontal segmented pill of icon buttons (library / watched /
 * share / ratings). Clean-room Tailwind rewrite: one flat chrome-glass pill (it floats
 * over the detail backdrop art, so black-alpha, never a white lift), blurred with the
 * shared glass token, with fixed-square focusable cells (never padding-sized) whose
 * glyphs sit at 0.7 opacity and lift to full on hover / focus. The `size` prop
 * replaces the old cross-component LESS `:import` that shrank the group inside
 * MetaPreview. Tooltips come from the foundation-kit Radix Tooltip.
 */

import React from 'react';
import { cn } from 'rillio/components/ui/cn';
import { Tooltip } from 'rillio/components/ui/tooltip';

type Item = {
    icon: React.ComponentType<{ className?: string }>;
    iconClassName?: string;
    label?: string;
    filled?: string;
    disabled?: boolean;
    className?: string;
    onClick?: () => void;
};

type Props = {
    items: Item[];
    className?: string;
    /** `default` = 4rem hero pill; `sm` = 2.5rem row pill (MetaPreview meta-actions). */
    size?: 'default' | 'sm';
};

const containerSize = {
    default: 'h-16 max-sm:h-12',
    sm: 'h-10',
} as const;

const cellSize = {
    default: 'size-16 max-sm:size-12',
    sm: 'h-10 w-11',
} as const;

const iconSize = {
    default: 'size-8 max-sm:size-7',
    sm: 'size-[1.15rem]',
} as const;

const ActionsGroup = ({ items, className, size = 'default' }: Props) => {
    return (
        <div
            className={cn(
                'flex w-fit flex-row items-center justify-start rounded-full bg-glass-chrome backdrop-blur-(--glass-blur)',
                containerSize[size],
                className,
            )}
        >
            {
                items.map((item, index) => {
                    const ItemIcon = item.icon;
                    return (
                        <Tooltip key={index} label={item.label} side="top">
                            <div
                                className={cn(
                                    'group flex cursor-pointer items-center justify-center rounded-full outline-none',
                                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight',
                                    cellSize[size],
                                    item.disabled && 'pointer-events-none',
                                    item.className,
                                )}
                                tabIndex={0}
                                onClick={item.disabled ? undefined : item.onClick}
                            >
                                <ItemIcon
                                    className={cn(
                                        'text-fg opacity-70 transition-opacity duration-150',
                                        'group-hover:opacity-100 group-focus:opacity-100',
                                        iconSize[size],
                                        item.iconClassName,
                                    )}
                                />
                            </div>
                        </Tooltip>
                    );
                })
            }
        </div>
    );
};

export default ActionsGroup;
