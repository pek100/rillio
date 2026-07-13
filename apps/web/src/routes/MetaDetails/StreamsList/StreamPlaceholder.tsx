// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Stream row skeleton, shown before an addon's streams resolve. Mirrors a curated
 * stream row's geometry (addon block + two text lines + trailing play circle) so
 * the layout does not jump when real content arrives.
 */

import React from 'react';

const StreamPlaceholder = () => (
    <div className="flex animate-pulse items-center gap-4 px-4 py-2">
        <div className="h-8 w-20 flex-none rounded-md bg-white/5" />
        <div className="flex-1 space-y-2">
            <div className="h-[1.2rem] w-4/5 rounded-md bg-white/5" />
            <div className="h-[1.2rem] w-2/5 rounded-md bg-white/5" />
        </div>
        <div className="size-14 flex-none rounded-full bg-white/5" />
    </div>
);

export default StreamPlaceholder;
