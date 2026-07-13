// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar month pager (clean-room Tailwind rewrite of Selector.less). Two icon+label
 * nav Buttons around the current month/year title. Both navigate via
 * navigate(toPath(deepLinks.calendar)); the deep-link builders are reused verbatim.
 */

import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { toPath } from 'rillio-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from 'rillio/components/ui/button';
import useCalendarDate from '../useCalendarDate';

type Props = {
    selected: CalendarSelected,
    selectable: CalendarSelectable,
    profile: Profile,
};

const NAV_BUTTON = 'flex h-10 w-24 items-center justify-between p-0 text-sm font-medium text-fg-muted hover:text-fg active:scale-[0.97]';

const Selector = ({ selected, selectable, profile }: Props) => {
    const { toMonth } = useCalendarDate(profile);
    const navigate = useNavigate();

    const [prev, next] = useMemo(() => (
        [selectable.prev, selectable.next]
    ), [selectable]);

    const onPrev = useCallback(() => {
        navigate(toPath(prev.deepLinks.calendar));
    }, [prev]);

    const onNext = useCallback(() => {
        navigate(toPath(next.deepLinks.calendar));
    }, [next]);

    return (
        <div className={'flex flex-none items-center justify-center gap-4 px-4 max-[1300px]:justify-between'}>
            <Button variant={'ghost'} className={`${NAV_BUTTON} pl-2 pr-5`} onClick={onPrev}>
                <ChevronLeft className={'size-4'} />
                <div className={'overflow-hidden text-ellipsis whitespace-nowrap'}>
                    {toMonth(prev, 'short')}
                </div>
            </Button>
            <div className={'w-[8.5rem] text-center'}>
                <div className={'text-xs font-semibold leading-none tracking-[0.06em] text-fg-muted'}>
                    {selected?.year}
                </div>
                <div className={'overflow-hidden text-ellipsis whitespace-nowrap text-2xl font-semibold text-fg'}>
                    {toMonth(selected, 'long')}
                </div>
            </div>
            <Button variant={'ghost'} className={`${NAV_BUTTON} pl-5 pr-2`} onClick={onNext}>
                <div className={'overflow-hidden text-ellipsis whitespace-nowrap'}>
                    {toMonth(next, 'short')}
                </div>
                <ChevronRight className={'size-4'} />
            </Button>
        </div>
    );
};

export default Selector;
