// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

// urlParams is accepted (and ignored) to match the existing call site; season is
// read from the query string, not the path params.
const useSeason = (_urlParams?: unknown): [number | null, (season: number) => void] => {
    const location = useLocation();
    const navigate = useNavigate();
    const [queryParams] = useSearchParams();
    const season = React.useMemo(() => {
        const value = queryParams.get('season');
        return queryParams.has('season') && value !== null && !isNaN(value as unknown as number) ?
            parseInt(value, 10)
            :
            null;
    }, [queryParams]);
    const setSeason = React.useCallback((season: number) => {
        const nextQueryParams = new URLSearchParams(queryParams);
        nextQueryParams.set('season', String(season));
        const path = location.pathname.endsWith('/') ?
            location.pathname.slice(0, -1) :
            location.pathname;
        navigate(`${path}?${nextQueryParams}`, { replace: true });
    }, [location.pathname, queryParams, navigate]);
    return [season, setSeason];
};

export default useSeason;
