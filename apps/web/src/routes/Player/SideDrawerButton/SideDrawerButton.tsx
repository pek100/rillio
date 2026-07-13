// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Edge tab that toggles the SideDrawer. Bare chevron over the video (no container),
 * the glyph carries a drop shadow for legibility on bright frames (flat theme); the
 * generous box is purely a hit area. Restyled onto Tailwind tokens.
 */

import React from 'react';
import Icon from '@stremio/stremio-icons/react';

type Props = {
    className?: string;
    onClick: () => void;
};

const SideDrawerButton = ({ className, onClick }: Props) => {
    return (
        <div
            className={`group flex h-50 w-30 cursor-pointer items-center justify-start pl-2 [-webkit-tap-highlight-color:transparent] max-[1000px]:h-32 max-[1000px]:w-[4.5rem] ${className ?? ''}`}
            onClick={onClick}
        >
            <Icon
                name={'chevron-back'}
                className={'relative size-10 text-fg opacity-60 transition-opacity [filter:drop-shadow(0_0.125rem_0.375rem_rgba(0,0,0,0.7))] group-hover:opacity-100 max-[1000px]:size-8'}
            />
        </div>
    );
};

export default SideDrawerButton;
