// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useSearchParams } from 'react-router-dom';

const useAddonDetailsTransportUrl = (urlParams: UrlParams): [string | null, (transportUrl: string | null) => void] => {
    const [queryParams, setQueryParams] = useSearchParams();
    const transportUrl = React.useMemo(() => {
        return queryParams.get('addon');
    }, [queryParams]);
    const setTransportUrl = React.useCallback((transportUrl: string | null) => {
        const nextQueryParams = new URLSearchParams(queryParams);
        if (typeof transportUrl === 'string') {
            nextQueryParams.set('addon', transportUrl);
        } else {
            nextQueryParams.delete('addon');
        }

        setQueryParams(nextQueryParams, { replace: true });
    }, [urlParams, queryParams]);
    return [transportUrl, setTransportUrl];
};

export default useAddonDetailsTransportUrl;
