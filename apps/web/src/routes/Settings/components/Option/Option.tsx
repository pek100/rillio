// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import { t } from 'i18next';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    className?: string,
    icon?: React.ComponentType<{ className?: string }>,
    iconClassName?: string,
    label: string,
    children: React.ReactNode,
};

const Option = ({ className, icon, iconClassName, label, children }: Props) => {
    const IconComp = icon;
    return (
        <div className={cn('mb-8 flex w-full flex-none items-center gap-8', className)}>
            <div className="flex flex-1 basis-1/2 items-center gap-3">
                {IconComp ? <IconComp className={cn('size-6 text-fg', iconClassName)} /> : null}
                <div className="line-clamp-2 font-medium leading-6 text-fg">
                    {t(label)}
                </div>
            </div>
            <div className="flex flex-1 basis-1/2 items-center justify-center">
                {children}
            </div>
        </div>
    );
};

export default Option;
