// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import useModelState from 'rillio/common/useModelState';

const useLocalSearch = (): { items: LocalSearchItem[], search: (query: string) => void } => {
    const core = useCore();

    const action = React.useMemo(() => ({
        action: 'Load',
        args: {
            model: 'LocalSearch',
        }
    }), []);

    const { items } = useModelState({ model: 'local_search', action }) as { items: LocalSearchItem[] };

    const search = React.useCallback((query: string) => {
        core.transport.dispatch({
            action: 'Search',
            args: {
                action: 'Search',
                args: {
                    searchQuery: query,
                    maxResults: 5
                }
            },
        });
    }, []);

    return {
        items,
        search,
    };
};

export default useLocalSearch;
