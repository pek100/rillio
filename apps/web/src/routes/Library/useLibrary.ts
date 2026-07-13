// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import { useModelState } from 'rillio/common';

const useLibrary = (model: string, urlParams: UrlParams, queryParams: URLSearchParams): [Library, () => void] => {
    const core = useCore();
    const loadNextPage = React.useCallback(() => {
        core.transport.dispatch({
            action: 'LibraryWithFilters',
            args: {
                action: 'LoadNextPage',
            }
        }, 'library');
    }, []);
    const action = React.useMemo(() => ({
        action: 'Load',
        args: {
            model: 'LibraryWithFilters',
            args: {
                request: {
                    type: typeof urlParams.type === 'string' ? urlParams.type : null,
                    sort: queryParams.has('sort') ? queryParams.get('sort') : undefined,
                }
            }
        }
    }), [urlParams, queryParams]);
    const library = useModelState({ model, action }) as Library;
    return [library, loadNextPage];
};

export default useLibrary;
