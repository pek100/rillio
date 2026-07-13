// Copyright (C) 2017-2024 Smart code 203358507

/**
 * NavTabButton - a single tab in the VerticalNavBar (meta-extension addon tabs).
 * Clean-room rewrite onto Tailwind tokens; the logo-with-icon-fallback, the
 * selected accent state, the hover-reveal label, and the double-click scroll-to-top
 * are preserved verbatim.
 */

import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';
import Image from 'rillio/components/Image';

type Props = {
    className?: string;
    logo?: string;
    icon?: string;
    label?: string;
    href?: string;
    selected?: boolean;
    onClick?: (event: React.MouseEvent) => void;
};

const NavTabButton = ({ className, logo, icon, label, href, selected, onClick }: Props) => {
    const renderLogoFallback = useCallback(() => (
        typeof icon === 'string' && icon.length > 0 ?
            <Icon className="h-[2.2rem] w-[2.2rem] flex-none" name={icon} />
            :
            null
    ), [icon]);
    const onDoubleClick = () => {
        const scrollableElements = document.querySelectorAll('div');

        scrollableElements.forEach((element) => {
            if (element.scrollTop > 0) {
                element.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    };
    return (
        <Link
            className={cn(
                'group flex flex-col items-center justify-center rounded-[var(--border-radius)] bg-transparent transition-colors hover:bg-[var(--overlay-color)]',
                className,
            )}
            title={label}
            tabIndex={-1}
            to={href as string}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
        >
            {
                typeof logo === 'string' && logo.length > 0 ?
                    <Image
                        className="h-[2.2rem] w-[2.2rem] flex-none mb-2"
                        src={logo}
                        alt={' '}
                        renderFallback={renderLogoFallback}
                    />
                    :
                    typeof icon === 'string' && icon.length > 0 ?
                        <Icon
                            className={cn('h-[2.2rem] w-[2.2rem] flex-none mb-2', selected ? 'text-accent opacity-100' : 'text-fg opacity-35')}
                            name={selected ? icon : `${icon}-outline`}
                        />
                        :
                        null
            }
            {
                typeof label === 'string' && label.length > 0 ?
                    <div className={cn(
                        'relative max-h-[2.4em] max-w-full flex-none overflow-hidden text-ellipsis whitespace-nowrap px-2 text-center text-[0.8rem] font-medium tracking-[0.01rem] transition-opacity',
                        selected ? 'text-accent max-sm:opacity-100 group-hover:opacity-100' : 'text-fg max-sm:opacity-60 group-hover:opacity-60',
                        'opacity-0',
                    )}>{label}</div>
                    :
                    null
            }
        </Link>
    );
};

export default NavTabButton;
