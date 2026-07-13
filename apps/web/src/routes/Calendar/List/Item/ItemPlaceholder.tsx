// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Agenda skeleton (clean-room Tailwind rewrite of the .placeholder branch of
 * Item.less). Same geometry as a real Item: a heading bar over one video row of
 * pill-shaped skeleton bars.
 */

import React from 'react';

const ItemPlaceholder = () => {
    return (
        <div className={'pointer-events-none flex flex-none flex-col overflow-hidden rounded-card border-[0.15rem] border-transparent bg-surface opacity-70'}>
            <div className={'flex h-14 flex-none items-center px-4'}>
                <div className={'h-[1.2rem] w-32 rounded-full bg-line'} />
            </div>
            <div className={'flex flex-auto flex-col'}>
                <div className={'flex h-12 flex-none flex-row items-center justify-between gap-4 px-4'}>
                    <div className={'h-[1.2rem] w-48 flex-auto rounded-full bg-line'} />
                    <div className={'h-[1.2rem] w-16 flex-none rounded-full bg-line'} />
                </div>
            </div>
        </div>
    );
};

export default ItemPlaceholder;
