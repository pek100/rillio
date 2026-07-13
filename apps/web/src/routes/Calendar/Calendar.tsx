// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar route (clean-room Tailwind rewrite). Two-pane month view: a Selector +
 * Table main column beside a per-day agenda List, with a bottom Drawer (foundation
 * kit, vaul) carrying the day Details on narrow layouts where the List collapses.
 *
 * Visuals only - useCalendar / useCalendarDate / the selected-day state and every
 * deep-link builder are reused verbatim. The old components/BottomSheet is replaced by
 * the kit Drawer per the component-map unification: controlled open from `selected`
 * (gated to the narrow breakpoints the sheet used to reveal on), and force-closed on
 * orientation change like the old sheet did.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useProfile, withCoreSuspender } from 'rillio/common';
import useOrientation from 'rillio/common/useOrientation';
import { MainNavBars } from 'rillio/components';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from 'rillio/components/ui/drawer';
import Selector from './Selector';
import Table from './Table';
import List from './List';
import Details from './Details';
import useCalendar from './useCalendar';
import useCalendarDate from './useCalendarDate';
import useIsNarrow from './useIsNarrow';

const CALENDAR_CLASS = 'h-[calc(100%-var(--safe-area-inset-bottom))] bg-transparent';

const Calendar = () => {
    const { year, month } = useParams();
    const urlParams = React.useMemo(() => ({
        year,
        month
    }), [year, month]);
    const calendar = useCalendar(urlParams);
    const profile = useProfile();
    const orientation = useOrientation();
    const isNarrow = useIsNarrow();

    const { toDayMonth } = useCalendarDate(profile);

    const [selected, setSelected] = useState<CalendarDate | null>(null);

    const detailsTitle = useMemo(() => toDayMonth(selected), [selected, toDayMonth]);

    // Force-close the day Drawer on rotate, exactly like the old BottomSheet did.
    useEffect(() => {
        setSelected(null);
    }, [orientation]);

    const onDrawerOpenChange = (open: boolean) => {
        if (!open) {
            setSelected(null);
        }
    };

    return (
        <MainNavBars className={CALENDAR_CLASS} route={'calendar'}>
            <div className={'relative mx-auto flex h-full w-full max-w-[78rem] flex-row gap-4 px-6 pb-6 max-[640px]:p-0 animation-fade-in'}>
                <div className={'relative flex flex-auto flex-col gap-4'}>
                    <Selector
                        selected={calendar.selected}
                        selectable={calendar.selectable}
                        profile={profile}
                    />
                    <Table
                        items={calendar.items}
                        selected={selected}
                        monthInfo={calendar.monthInfo}
                        onChange={setSelected}
                    />
                </div>
                <List
                    items={calendar.items}
                    selected={selected}
                    monthInfo={calendar.monthInfo}
                    profile={profile}
                    onChange={setSelected}
                />
                <Drawer open={!!selected && isNarrow} onOpenChange={onDrawerOpenChange}>
                    <DrawerContent className={'max-h-[calc(100%-var(--horizontal-nav-bar-size))]'}>
                        <DrawerHeader className={'px-6 pb-6 pt-2 text-left'}>
                            <DrawerTitle className={'text-xl font-semibold'}>
                                {detailsTitle}
                            </DrawerTitle>
                        </DrawerHeader>
                        <div className={'overflow-y-auto pb-4'}>
                            <Details
                                selected={selected}
                                items={calendar.items}
                            />
                        </div>
                    </DrawerContent>
                </Drawer>
            </div>
        </MainNavBars>
    );
};

const CalendarFallback = () => (
    <MainNavBars className={CALENDAR_CLASS} />
);

export default withCoreSuspender(Calendar, CalendarFallback);
