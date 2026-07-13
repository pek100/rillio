// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import { t } from 'i18next';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    icon: React.ComponentType<{ className?: string }>,
    label: string,
    children: React.ReactNode,
};

const Category = ({ icon, label, children }: Props) => {
    const IconComp = icon;
    return (
        <div className={cn(
            'mb-4 flex w-full flex-col items-start pb-4',
            '[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line',
        )}>
            <div className="mb-4 flex h-11 items-center gap-3">
                <IconComp className="size-5 flex-none text-fg" />
                <div className="flex-none text-[1.05rem] font-semibold text-fg">
                    {t(label)}
                </div>
            </div>
            {children}
        </div>
    );
};

export default Category;
