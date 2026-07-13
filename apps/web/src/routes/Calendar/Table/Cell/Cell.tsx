// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar day cell (clean-room Tailwind rewrite of Cell.less).
 *
 * The whole cell is the foundation-kit Button (ghost, neutralized to a flat
 * full-bleed container) so day selection keeps the Button behavior layer. The poster
 * strip is a HorizontalScroll of poster Buttons that navigate via navigateWithOrigin
 * (click stops propagation so the poster opens instead of selecting the day). Every
 * hook and the navigate contract are reused verbatim; only the view moves to tokens.
 *
 * Note: the height-constrained phone breakpoints from the old .less (compact-items on
 * @phone-portrait/@phone-landscape) are dropped - this is a Windows desktop app and
 * those never fire; the width-based collapse (@minimum, @small portrait) is preserved.
 */

import React, { useCallback, useMemo, MouseEvent } from 'react';
import Icon from '@stremio/stremio-icons/react';
import { useNavigateWithOrigin } from 'rillio-router';
import { HorizontalScroll, Image } from 'rillio/components';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    date: CalendarDate,
    items: CalendarContentItem[],
    onClick: (date: CalendarDate) => void,
};

const Cell = ({ selected, monthInfo, date, items, onClick }: Props) => {
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [active, today] = useMemo(() => [
        date.day === selected?.day,
        date.day === monthInfo.today,
    ], [selected, monthInfo, date]);

    const onCellClick = () => {
        onClick && onClick(date);
    };

    const onPosterClick = useCallback((event: MouseEvent<HTMLDivElement>, target: string) => {
        event.preventDefault();
        event.stopPropagation();
        navigateWithOrigin(target);
    }, [navigateWithOrigin]);

    return (
        <Button
            variant={'ghost'}
            className={cn(
                'relative flex h-auto flex-col justify-between gap-2 overflow-hidden rounded-none p-0 text-base font-normal',
                'bg-surface border-[0.15rem] transition-[border-color,background-color] duration-150 ease-smooth',
                'first:rounded-tl-card [&:nth-child(7)]:rounded-tr-card last:rounded-br-card',
                active
                    ? 'border-accent hover:bg-surface'
                    : 'border-transparent hover:border-line',
            )}
            onClick={onCellClick}
        >
            <div className={cn('relative flex items-start', today && 'p-[0.3rem]')}>
                <div className={cn(
                    'flex-none flex items-center justify-center rounded-full font-medium',
                    today ? 'h-6 w-6 bg-accent text-bg' : 'h-8 w-8 text-fg',
                )}>
                    {date.day}
                </div>
            </div>
            <HorizontalScroll className={'relative flex flex-row gap-[0.2rem] p-[0.1rem] flex-[1_1_60%] overflow-y-hidden min-w-0'}>
                {
                    items.map(({ id, name, poster, deepLinks }) => (
                        <Button
                            key={id}
                            variant={'ghost'}
                            className={cn(
                                'group flex-none flex h-full aspect-[2/3] items-center justify-center gap-0 rounded-[0.375rem] p-0 hover:bg-transparent',
                                'max-h-full max-w-full overflow-hidden',
                                'max-[640px]:pointer-events-none max-[1300px]:portrait:pointer-events-none',
                            )}
                            href={deepLinks.metaDetailsStreams}
                            tabIndex={-1}
                            onClick={(event) => onPosterClick(event, deepLinks.metaDetailsStreams)}
                        >
                            <Icon
                                className={'absolute z-[1] h-8 w-8 rounded-full bg-accent p-2 text-bg opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100'}
                                name={'play'}
                            />
                            <Image
                                className={'h-auto max-h-full aspect-[2/3] object-cover rounded-[inherit] transition-opacity duration-150 ease-smooth group-hover:opacity-50'}
                                src={poster}
                                alt={name}
                            />
                        </Button>
                    ))
                }
            </HorizontalScroll>
            {
                items.length > 0 ?
                    <Icon className={'hidden h-8 w-8 shrink-0 self-center p-2 text-fg-subtle'} name={'more-horizontal'} />
                    :
                    null
            }
        </Button>
    );
};

export default Cell;
