// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import { useModelState } from 'rillio/common';

const useSearch = (queryParams: URLSearchParams): [Search, (range: { start: number; end: number }) => void] => {
    const core = useCore();
    const action = React.useMemo(() => {
        const query = queryParams.get('search') ?? queryParams.get('query');
        if (query != null && query.length > 0) {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogsWithExtra',
                    args: {
                        extra: [
                            ['search', query]
                        ]
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [queryParams]);
    const loadRange = React.useCallback((range: { start: number; end: number }) => {
        core.transport.dispatch({
            action: 'CatalogsWithExtra',
            args: {
                action: 'LoadRange',
                args: range
            }
        }, 'search');
    }, []);
    const search = useModelState({ model: 'search', action }) as Search;
    return [search, loadRange];
};

export default useSearch;
