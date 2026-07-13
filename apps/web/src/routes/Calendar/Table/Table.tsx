// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar month grid (clean-room Tailwind rewrite of Table.less). A 7-column week
 * header (long labels, 3-char short labels on narrow widths) over a CSS grid with
 * leading empty spacers for monthInfo.firstWeekday, then one Cell per day. All logic
 * (weekday i18n, firstWeekday offset) is unchanged.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Cell from './Cell/Cell';

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Props = {
    items: CalendarItem[],
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    onChange: (date: CalendarDate) => void,
};

const Table = ({ items, selected, monthInfo, onChange }: Props) => {
    const { t } = useTranslation();

    const cellsOffset = useMemo(() => {
        return Array.from(Array(monthInfo.firstWeekday).keys());
    }, [monthInfo]);

    return (
        <div className={'relative flex flex-auto flex-col'}>
            <div className={'relative grid h-12 w-full flex-none grid-cols-7 items-center'}>
                {
                    WEEK_DAYS.map((day) => (
                        <div
                            className={'relative overflow-hidden text-ellipsis whitespace-nowrap p-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fg-muted'}
                            key={day}
                        >
                            <span className={'block max-[1000px]:hidden'}>
                                {t(day)}
                            </span>
                            <span className={'hidden max-[1000px]:block'}>
                                {t(day).slice(0, 3)}
                            </span>
                        </div>
                    ))
                }
            </div>
            <div className={'relative grid h-full w-full flex-auto auto-rows-fr grid-cols-7 gap-px'}>
                {
                    cellsOffset.map((day) => (
                        <span key={day} />
                    ))
                }
                {
                    items.map((item) => (
                        <Cell
                            key={item.date.day}
                            {...item}
                            selected={selected}
                            monthInfo={monthInfo}
                            onClick={onChange}
                        />
                    ))
                }
            </div>
        </div>
    );
};

export default Table;
