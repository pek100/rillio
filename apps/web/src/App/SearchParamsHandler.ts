// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { deepEqual } from 'fast-equals';
import { useCore } from 'rillio/core';
import { withCoreSuspender, useProfile, useToast } from 'rillio/common';

const SearchParamsHandler = () => {
    const core = useCore();
    const profile = useProfile();
    const toast = useToast();

    const [searchParams, setSearchParams] = React.useState<Record<string, string>>({});

    const onLocationChange = () => {
        const { origin, hash, search } = window.location;
        const { searchParams } = new URL(`${origin}${hash.replace('#', '')}${search}`);

        setSearchParams((previousSearchParams) => {
            const currentSearchParams = Object.fromEntries(searchParams.entries());
            return deepEqual(previousSearchParams, currentSearchParams) ? previousSearchParams : currentSearchParams;
        });
    };

    React.useEffect(() => {
        const { streamingServerUrl } = searchParams;

        if (streamingServerUrl) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'UpdateSettings',
                    args: {
                        ...profile.settings,
                        streamingServerUrl,
                    },
                },
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'AddServerUrl',
                    args: streamingServerUrl,
                },
            });
            toast.show({
                type: 'success',
                title: `Using streaming server at ${streamingServerUrl}`,
                timeout: 4000,
            });
        }
    }, [searchParams]);

    React.useEffect(() => {
        onLocationChange();
        window.addEventListener('hashchange', onLocationChange);
        return () => window.removeEventListener('hashchange', onLocationChange);
    }, []);

    return null;
};

export default withCoreSuspender(SearchParamsHandler);
