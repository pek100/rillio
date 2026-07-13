// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Horizontally-scrolling container that fades its overflowing edges with a
 * mask-gradient tied to scroll position (left / center / right). Clean-room rewrite
 * of HorizontalScroll.less: the scroll-position derivation is unchanged and the
 * mask gradients move to inline style (cosmetic geometry, no tokens). No arrows, no
 * snap - just the gradient affordance.
 */

import React, { useRef, useEffect, useState } from 'react';
import { cn } from 'rillio/components/ui/cn';

const SCROLL_THRESHOLD = 1;
const MASK_WIDTH = '10%';

const MASK: Record<string, string> = {
    left: `linear-gradient(90deg, rgba(0,0,0,1) calc(100% - ${MASK_WIDTH}), rgba(0,0,0,0) 100%)`,
    right: `linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) ${MASK_WIDTH})`,
    center: `linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) ${MASK_WIDTH}, rgba(0,0,0,1) calc(100% - ${MASK_WIDTH}), rgba(0,0,0,0) 100%)`,
};

type Props = {
    className?: string,
    children: React.ReactNode,
};

const HorizontalScroll = ({ className, children }: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const [scrollPosition, setScrollPosition] = useState<'left' | 'center' | 'right'>('left');

    useEffect(() => {
        const onScroll = ({ target }: Event) => {
            const { scrollLeft, scrollWidth, offsetWidth } = target as HTMLDivElement;

            setScrollPosition(() => (
                (scrollLeft - SCROLL_THRESHOLD) <= 0 ? 'left' :
                    (scrollLeft + offsetWidth + SCROLL_THRESHOLD) >= scrollWidth ? 'right' :
                        'center'
            ));
        };

        const node = ref.current;
        node?.addEventListener('scroll', onScroll);
        return () => node?.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <div
            ref={ref}
            className={cn('relative overflow-x-auto', className)}
            style={{ maskImage: MASK[scrollPosition], WebkitMaskImage: MASK[scrollPosition] }}
        >
            {children}
        </div>
    );
};

export default HorizontalScroll;
