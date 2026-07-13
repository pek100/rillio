// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar agenda group (clean-room Tailwind rewrite of Item.less). A day heading over
 * a divided list of episode Buttons. Selecting the group calls onClick(date); each
 * episode navigates via navigateWithOrigin (click stops propagation). The active-group
 * auto-scrollIntoView effect is reused verbatim.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import Icon from '@stremio/stremio-icons/react';
import { useNavigateWithOrigin } from 'rillio-router';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';
import useCalendarDate from '../../useCalendarDate';

type Props = {
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    date: CalendarDate,
    items: CalendarContentItem[],
    profile: Profile,
    onClick: (date: CalendarDate) => void,
};

const Item = ({ selected, monthInfo, date, items, profile, onClick }: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const { toDayMonth } = useCalendarDate(profile);

    const [active, today] = useMemo(() => [
        date.day === selected?.day,
        date.day === monthInfo.today,
    ], [selected, monthInfo, date]);

    const onItemClick = () => {
        onClick && onClick(date);
    };

    const onVideoClick = (event: React.MouseEvent<HTMLDivElement>, target: string) => {
        event.preventDefault();
        event.stopPropagation();
        navigateWithOrigin(target);
    };

    useEffect(() => {
        active && ref.current?.scrollIntoView({
            block: 'start',
            behavior: 'smooth',
        });
    }, [active]);

    return (
        <div
            ref={ref}
            className={cn(
                'relative flex flex-none flex-col overflow-hidden rounded-card bg-surface border-[0.15rem] transition-[border-color,background-color] duration-150 ease-smooth',
                active ? 'border-accent' : 'border-transparent hover:border-line',
            )}
            key={date.day}
            onClick={onItemClick}
        >
            <div className={cn(
                'relative flex h-14 flex-none items-center px-4 text-base font-semibold',
                today ? 'bg-accent text-bg' : 'text-fg',
            )}>
                {toDayMonth(date)}
            </div>
            <div className={'flex flex-auto flex-col'}>
                {
                    items.map(({ id, name, season, episode, deepLinks }) => (
                        <Button
                            key={id}
                            variant={'ghost'}
                            className={'group relative flex h-12 w-full flex-none flex-row items-center justify-between gap-4 rounded-none px-4 py-0 text-sm font-medium text-fg last:rounded-b-card'}
                            href={deepLinks.metaDetailsStreams}
                            onClick={(event) => onVideoClick(event, deepLinks.metaDetailsStreams)}
                        >
                            <div className={'min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap text-left'}>
                                {name}
                            </div>
                            <div className={'block flex-none text-fg-muted group-hover:hidden'}>
                                S{season}E{episode}
                            </div>
                            <Icon className={'hidden h-8 w-8 flex-none rounded-full bg-accent p-2 text-bg group-hover:block'} name={'play'} />
                        </Button>
                    ))
                }
            </div>
        </div>
    );
};

export default Item;
