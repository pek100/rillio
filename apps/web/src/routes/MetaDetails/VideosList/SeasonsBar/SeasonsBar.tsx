// Copyright (C) 2017-2023 Smart code 203358507

/**
 * SeasonsBar (Phase 3 clean-room rewrite) - prev / season-select / next pager.
 *
 * View rebuilt on the kit Select (season dropdown, portaled so it escapes the
 * overflow-clip streams panel) + two kit Buttons for prev/next. The season-stepping
 * index math, disabled-edge logic, and the onSelect({ type: 'select', value })
 * contract are preserved verbatim (also consumed by the Player SideDrawer). Ships a
 * static .Placeholder mirroring the bar geometry.
 */

import React from 'react';
import { t } from 'i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'rillio/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from 'rillio/components/ui/select';
import { cn } from 'rillio/components/ui/cn';

type SelectEvent = { type: 'select'; value: string; reactEvent?: React.SyntheticEvent; nativeEvent?: Event };

type Props = {
    className?: string;
    seasons: number[];
    season: number;
    onSelect?: (event: SelectEvent) => void;
};

const SeasonsBar = ({ className, seasons, season, onSelect }: Props) => {
    const options = React.useMemo(() => {
        return seasons.map((season) => ({
            value: String(season),
            label: season > 0 ? t('SEASON_NUMBER', { season }) : t('SPECIAL')
        }));
    }, [seasons]);
    const selectedSeason = React.useMemo(() => {
        return String(season);
    }, [season]);
    const stepSeason = React.useCallback((direction: 'next' | 'prev', event: React.MouseEvent) => {
        if (typeof onSelect === 'function') {
            const seasonIndex = seasons.indexOf(season);
            const valueIndex = direction === 'next' ?
                seasonIndex + 1 < seasons.length ? seasonIndex + 1 : seasons.length - 1
                :
                seasonIndex - 1 >= 0 ? seasonIndex - 1 : 0;
            const value = seasons[valueIndex];
            onSelect({
                type: 'select',
                value: String(value),
                reactEvent: event,
                nativeEvent: event.nativeEvent
            });
        }
    }, [season, seasons, onSelect]);
    const seasonOnSelect = React.useCallback((value: string) => {
        if (typeof onSelect === 'function') {
            onSelect({ type: 'select', value });
        }
    }, [onSelect]);

    const [prevDisabled, nextDisabled] = React.useMemo(() => {
        const currentIndex = seasons.indexOf(season);
        return [
            currentIndex === 0,
            currentIndex === seasons.length - 1
        ];
    }, [season, seasons]);

    return (
        <div className={cn('flex flex-row items-center justify-between overflow-visible p-4 max-sm:h-24', className)}>
            <Button
                variant="ghost"
                disabled={prevDisabled}
                title={t('PREV_SEASON')}
                onClick={(event) => stepSeason('prev', event)}
                className="h-12 w-[6.5rem] flex-none gap-2 px-2 font-medium text-fg"
            >
                <Icon className="size-6 flex-none" name={'chevron-back'} />
                <span className="flex-1 text-center">{t('BUTTON_PREV')}</span>
            </Button>
            <Select value={selectedSeason} onValueChange={seasonOnSelect}>
                <SelectTrigger className="bg-transparent text-fg hover:bg-surface-hover">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button
                variant="ghost"
                disabled={nextDisabled}
                title={t('NEXT_SEASON')}
                onClick={(event) => stepSeason('next', event)}
                className="h-12 w-[6.5rem] flex-none gap-2 px-2 font-medium text-fg"
            >
                <span className="flex-1 text-center">{t('BUTTON_NEXT')}</span>
                <Icon className="size-6 flex-none" name={'chevron-forward'} />
            </Button>
        </div>
    );
};

const SeasonsBarPlaceholder = ({ className }: { className?: string }) => (
    <div className={cn('flex flex-row items-center justify-between p-4', className)}>
        <div className="flex h-12 w-[6.5rem] items-center gap-2 px-2">
            <Icon className="size-6 flex-none text-fg-subtle" name={'chevron-back'} />
            <span className="flex-1 text-center font-medium text-fg-subtle">{t('PREV_SEASON')}</span>
        </div>
        <div className="mx-4 flex items-center gap-4">
            <span className="font-medium text-fg-subtle">{t('SEASON_NUMBER', { season: 1 })}</span>
            <Icon className="size-4 flex-none text-fg-subtle" name={'caret-down'} />
        </div>
        <div className="flex h-12 w-[6.5rem] items-center gap-2 px-2">
            <span className="flex-1 text-center font-medium text-fg-subtle">{t('NEXT_SEASON')}</span>
            <Icon className="size-6 flex-none text-fg-subtle" name={'chevron-forward'} />
        </div>
    </div>
);

SeasonsBar.Placeholder = SeasonsBarPlaceholder;

export default SeasonsBar;
