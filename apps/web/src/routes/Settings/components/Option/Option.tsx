// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import { t } from 'i18next';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    className?: string,
    icon?: string,
    iconClassName?: string,
    label: string,
    children: React.ReactNode,
};

const Option = ({ className, icon, iconClassName, label, children }: Props) => {
    return (
        <div className={cn('relative mb-8 flex w-full flex-none flex-row items-center gap-8 overflow-visible', className)}>
            <div className="relative flex flex-1 basis-1/2 flex-row items-center gap-3">
                {
                    icon &&
                        <Icon
                            className={cn('size-6 text-fg', iconClassName)}
                            name={icon}
                        />
                }
                <div className="line-clamp-2 font-medium leading-6 text-fg">
                    {t(label)}
                </div>
            </div>
            <div className="relative flex flex-1 basis-1/2 flex-row items-center justify-center overflow-visible">
                {children}
            </div>
        </div>
    );
};

export default Option;
