// Copyright (C) 2017-2025 Smart code 203358507

/**
 * EpisodePicker (Phase 3 clean-room rewrite) - season/episode steppers + submit,
 * shown in empty/error stream+video states to jump to a specific episode.
 *
 * Rebuilt on the kit NumberStepper (the one custom stepper primitive) + kit Button.
 * The path-parse seed (from the current videoId "id:season:episode"), the
 * disabled-when-unchanged guard, and the onSubmit(season, episode) contract are
 * preserved verbatim.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from 'rillio/components/ui/button';
import { NumberStepper } from 'rillio/components/ui/number-stepper';
import { cn } from 'rillio/components/ui/cn';

type Props = {
    className?: string,
    seriesId?: string;
    onSubmit: (season: number, episode: number) => void;
};

const EpisodePicker = ({ className, onSubmit }: Props) => {
    const { t } = useTranslation();
    const location = useLocation();

    const { initialSeason, initialEpisode } = useMemo(() => {
        const splitPath = location.pathname.split('/');
        if (splitPath[splitPath.length - 1] === '') {
            splitPath.pop();
        }
        const videoId = decodeURIComponent(splitPath[splitPath.length - 1]);
        const [, pathSeason, pathEpisode] = videoId ? videoId.split(':') : [];
        return {
            initialSeason: parseInt(pathSeason) || 0,
            initialEpisode: parseInt(pathEpisode) || 1
        };
    }, []);

    const [season, setSeason] = useState(initialSeason);
    const [episode, setEpisode] = useState(initialEpisode);

    const handleSubmit = useCallback(() => {
        onSubmit(season, episode);
    }, [onSubmit, season, episode]);

    const disabled = season === initialSeason && episode === initialEpisode;

    return (
        <div className={cn('flex flex-col items-center gap-3', className)}>
            <div className="flex items-center gap-3">
                <NumberStepper min={0} label={t('SEASON')} value={season} onValueChange={setSeason} aria-label={t('SEASON')} />
                <NumberStepper min={1} label={t('EPISODE')} value={episode} onValueChange={setEpisode} aria-label={t('EPISODE')} />
            </div>
            <Button
                onClick={handleSubmit}
                disabled={disabled}
                className="my-2 h-14 px-8 text-base font-bold"
            >
                {t('SIDEBAR_SHOW_STREAMS')}
            </Button>
        </div>
    );
};

export default EpisodePicker;
