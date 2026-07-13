// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import { t } from 'i18next';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    icon: string,
    label: string,
    children: React.ReactNode,
};

const Category = ({ icon, label, children }: Props) => {
    return (
        <div className={cn(
            'relative mb-4 flex w-full flex-col items-start overflow-visible pb-4',
            '[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line',
        )}>
            <div className="relative mb-4 flex h-11 flex-row items-center gap-3">
                <Icon className="size-5 flex-none text-fg" name={icon} />
                <div className="flex-none text-[1.05rem] font-semibold text-fg">
                    {t(label)}
                </div>
            </div>
            {children}
        </div>
    );
};

export default Category;
