// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Calendar day detail (clean-room Tailwind rewrite of Details.less). The body of the
 * bottom Drawer on narrow layouts: a flat list of the selected day's episode Buttons,
 * or a "no new episodes" placeholder. The videos memo is reused verbatim.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'rillio/components/ui/button';

type Props = {
    selected: CalendarDate | null,
    items: CalendarItem[],
};

const Details = ({ selected, items }: Props) => {
    const { t } = useTranslation();
    const videos = useMemo(() => {
        return items.find(({ date }) => date.day === selected?.day)?.items ?? [];
    }, [selected, items]);

    return (
        <div className={'relative'}>
            {
                videos.map(({ id, name, season, episode, deepLinks }) => (
                    <Button
                        key={id}
                        variant={'ghost'}
                        className={'group relative flex h-16 w-full flex-none flex-row items-center justify-between gap-4 rounded-none px-6 py-0 text-sm font-medium text-fg active:bg-surface-hover'}
                        href={deepLinks.metaDetailsStreams}
                    >
                        <div className={'min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap text-left'}>
                            {name}
                        </div>
                        <div className={'block flex-none text-fg-muted'}>
                            S{season}E{episode}
                        </div>
                        <Icon
                            className={'h-8 w-8 flex-none rounded-full p-2 text-fg transition-[background-color,color] duration-150 ease-smooth group-hover:bg-accent group-hover:text-bg group-active:bg-accent group-active:text-bg'}
                            name={'play'}
                        />
                    </Button>
                ))
            }
            {
                !videos.length ?
                    <div className={'flex h-40 items-center justify-center text-sm text-fg-muted'}>
                        {t('CALENDAR_NO_NEW_EPISODES')}
                    </div>
                    :
                    null
            }
        </div>
    );
};

export default Details;
