// Copyright (C) 2017-2024 Smart code 203358507

/**
 * VerticalNavBar - the meta-extension addon tab rail on the MetaDetails route.
 * Clean-room rewrite onto Tailwind tokens (styles.less retired). Collapses to a
 * horizontal scroller on narrow layouts, exactly like the legacy @minimum rules.
 */

import React, { forwardRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'rillio/components/ui/cn';
import NavTabButton from './NavTabButton';

type Tab = {
    id?: string;
    label?: string;
    logo?: string;
    icon?: string;
    href?: string;
    onClick?: (event: React.MouseEvent) => void;
};

type Props = {
    className?: string;
    selected?: string | null;
    tabs?: Tab[];
};

// Square tab; min 3.5rem tall. flex-none once the rail turns horizontal.
const NAV_TAB = 'w-[calc(var(--vertical-nav-bar-size)-1.2rem)] h-[calc(var(--vertical-nav-bar-size)-1.2rem)] min-h-[3.5rem] max-sm:flex-none max-sm:last:hidden [@media(max-height:640px)]:last:hidden';

const VerticalNavBar = memo(forwardRef<HTMLElement, Props>(({ className, selected, tabs }, ref) => {
    const { t } = useTranslation();
    return (
        <nav
            ref={ref}
            className={cn(
                'flex flex-col items-center gap-4 bg-transparent overflow-y-auto w-[var(--vertical-nav-bar-size)] py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                'max-sm:flex-row max-sm:justify-between max-sm:gap-0 max-sm:w-full max-sm:h-[var(--vertical-nav-bar-size)] max-sm:px-4 max-sm:overflow-y-hidden max-sm:overflow-x-auto',
                className,
            )}
        >
            {
                Array.isArray(tabs) ?
                    tabs.map((tab, index) => (
                        <NavTabButton
                            key={index}
                            className={NAV_TAB}
                            selected={tab.id === selected}
                            href={tab.href}
                            logo={tab.logo}
                            icon={tab.icon}
                            label={tab.label ? t(tab.label) : undefined}
                            onClick={tab.onClick}
                        />
                    ))
                    :
                    null
            }
        </nav>
    );
}));

VerticalNavBar.displayName = 'VerticalNavBar';

export default VerticalNavBar;
