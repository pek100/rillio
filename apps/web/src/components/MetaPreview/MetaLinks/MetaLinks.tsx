// Copyright (C) 2017-2025 Smart code 203358507

/**
 * MetaLinks - a titled row of link pills (genres etc.). Clean-room Tailwind on the
 * foundation-kit Button (each link is an <a> pill). The i18n label/prefix wiring is
 * reused verbatim.
 */

import React from 'react';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import useTranslate from 'rillio/common/useTranslate';

type Link = {
    label: string,
    href: string,
};

type Props = {
    className?: string,
    label?: string,
    links?: Link[],
};

const MetaLinks = ({ className, label, links }: Props) => {
    const { string, stringWithPrefix } = useTranslate();
    return (
        <div className={cn(className)}>
            {
                typeof label === 'string' && label.length > 0 ?
                    <div className="mb-3 text-[0.95rem] font-bold uppercase tracking-[0.05em] text-fg opacity-40">
                        { stringWithPrefix(label.toUpperCase(), 'LINKS_') }
                    </div>
                    :
                    null
            }
            {
                Array.isArray(links) && links.length > 0 ?
                    <div className="flex flex-row flex-wrap">
                        {links.map(({ label, href }, index) => (
                            <Button
                                key={index}
                                variant="ghost"
                                className={cn(
                                    'mb-3 mr-3 h-auto flex-grow-0 rounded-full border-2 border-transparent px-5 py-[0.4rem]',
                                    'whitespace-nowrap text-base font-medium text-fg',
                                    'bg-glass-chrome backdrop-blur-(--glass-blur) hover:bg-surface-hover',
                                    'focus-visible:border-highlight focus-visible:outline-none',
                                )}
                                title={label}
                                href={href}
                            >
                                { string(label) }
                            </Button>
                        ))}
                    </div>
                    :
                    null
            }
        </div>
    );
};

export default MetaLinks;
