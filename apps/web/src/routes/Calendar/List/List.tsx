// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar agenda pane (clean-room Tailwind rewrite of List.less). A right-edge
 * scroll column of day-grouped agenda Items (three skeletons while items are empty).
 * Hidden on narrow layouts where the BottomSheet/Drawer takes over. filteredItems is
 * unchanged.
 */

import React, { useMemo } from 'react';
import { Item, ItemPlaceholder } from './Item';

type Props = {
    items: CalendarItem[],
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    profile: Profile,
    onChange: (date: CalendarDate) => void,
};

const List = ({ items, selected, monthInfo, profile, onChange }: Props) => {
    const filteredItems = useMemo(() => {
        return items.filter(({ items }) => items.length);
    }, [items]);

    // Loaded with nothing scheduled this month: collapse the column entirely rather
    // than reserve a blank w-80 beside the grid. That empty column is what made the
    // calendar look pinned left / "not centered" - with it gone the grid's flex-auto
    // column fills the centered container. While still loading (items empty) the
    // skeletons below keep the two-pane shape. When there ARE items the agenda shows.
    if (items.length > 0 && filteredItems.length === 0) {
        return null;
    }

    return (
        <div className={'flex w-80 flex-none flex-col gap-4 overflow-y-auto px-4 [scroll-padding-block-start:0.15rem] max-[1300px]:landscape:w-[17rem] max-[1000px]:landscape:hidden max-[1300px]:portrait:hidden'}>
            {
                items.length === 0 ?
                    [1, 2, 3].map((index) => (
                        <ItemPlaceholder key={index} />
                    ))
                    :
                    filteredItems.map((item) => (
                        <Item
                            key={item.date.day}
                            {...item}
                            selected={selected}
                            monthInfo={monthInfo}
                            profile={profile}
                            onClick={onChange}
                        />
                    ))
            }
        </div>
    );
};

export default List;
