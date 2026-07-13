// Copyright (C) 2017-2024 Smart code 203358507

import React, { forwardRef } from 'react';
import { t } from 'i18next';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    className?: string,
    label?: string,
    children: React.ReactNode,
};

const Section = forwardRef<HTMLDivElement, Props>(({ className, label, children }: Props, ref) => {
    return (
        <div
            ref={ref}
            className={cn(
                'relative flex max-w-[35rem] flex-col items-start overflow-visible py-12',
                '[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line',
                className,
            )}
        >
            {
                label &&
                    <div className="mb-8 flex-none self-stretch text-[1.8rem] font-semibold leading-tight text-fg">
                        {t(label)}
                    </div>
            }
            {children}
        </div>
    );
});

Section.displayName = 'Section';

export default Section;
