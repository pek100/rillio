// Copyright (C) 2017-2025 Smart code 203358507

/**
 * ActionButton - a wide icon + label pill (the compact MetaPreview "SHOW" button).
 * Clean-room Tailwind on the foundation-kit Button (polymorphic href -> anchor).
 * When `tooltip` is set the label renders as a Radix Tooltip instead of inline text.
 */

import React from 'react';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import { Tooltip } from 'rillio/components/ui/tooltip';

type Props = {
    className?: string,
    icon?: React.ComponentType<{ className?: string }>,
    label?: string,
    tooltip?: boolean,
    href?: string,
    target?: string,
    tabIndex?: number,
    onClick?: (event: React.MouseEvent<HTMLDivElement>) => void,
};

const ActionButton = ({ className, icon, label, tooltip, ...props }: Props) => {
    const IconComp = icon;
    const showInlineLabel = !tooltip && typeof label === 'string' && label.length > 0;
    const button = (
        <Button
            variant="ghost"
            title={tooltip ? '' : label}
            {...props}
            className={cn(
                // Chrome glass: this pill floats over the detail backdrop ART, where the
                // old white-alpha lift read milky. Black-alpha darkening + the blur token.
                'group h-16 flex-none flex-row justify-center gap-4 rounded-full bg-glass-chrome px-8 backdrop-blur-(--glass-blur)',
                'hover:bg-surface-hover',
                showInlineLabel ? 'w-auto' : 'w-16 px-0',
                className,
            )}
        >
            {
                IconComp ?
                    <IconComp className="block size-7 text-fg opacity-90 transition-opacity group-hover:opacity-100" />
                    :
                    null
            }
            {
                showInlineLabel ?
                    <div className="px-[0.2rem] text-center text-base font-medium text-fg opacity-90 max-md:hidden">{label}</div>
                    :
                    null
            }
        </Button>
    );

    return tooltip ? <Tooltip label={label} side="top">{button}</Tooltip> : button;
};

export default ActionButton;
