// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Loading skeleton for an Addon row. Mirrors the flat divide-y row geometry (logo
 * square + stacked text lines + trailing action pills) with pulsing placeholder
 * blocks, so the skeleton-to-content swap has no layout jump.
 */

import React from 'react';
import { cn } from 'rillio/components/ui/cn';

const block = 'rounded-full bg-fg/10';

export const AddonPlaceholder = () => {
    return (
        <div className="flex animate-pulse items-start gap-4 px-6 py-5 max-sm:flex-wrap">
            <div className="size-14 shrink-0 rounded-card bg-fg/10 max-sm:mx-auto" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                <div className={cn(block, 'h-4 w-2/5')} />
                <div className={cn(block, 'h-3 w-3/5')} />
                <div className={cn(block, 'h-3 w-4/5')} />
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:hidden">
                <div className={cn(block, 'size-10')} />
                <div className={cn(block, 'h-9 w-24')} />
                <div className={cn(block, 'size-10')} />
            </div>
        </div>
    );
};
