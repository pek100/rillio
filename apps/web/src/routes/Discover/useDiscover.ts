// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import * as UrlUtils from 'url';
import { useCore } from 'rillio/core';
import { useModelState } from 'rillio/common';

const map = (discover: any) => ({
    ...discover,
    catalog: discover.catalog !== null && discover.catalog.content.type === 'Ready' ?
        {
            ...discover.catalog,
            content: {
                ...discover.catalog.content,
                content: discover.catalog.content.content.map((metaItem: any) => ({
                    ...metaItem,
                    released: new Date(typeof metaItem.released === 'string' ? metaItem.released : NaN),
                }))
            }
        }
        :
        discover.catalog
});

const useDiscover = (urlParams: UrlParams, queryParams: URLSearchParams): [Discover, () => void] => {
    const core = useCore();
    const loadNextPage = React.useCallback(() => {
        core.transport.dispatch({
            action: 'CatalogWithFilters',
            args: {
                action: 'LoadNextPage'
            }
        }, 'discover');
    }, []);
    const action = React.useMemo(() => {
        if (typeof urlParams.transportUrl === 'string' && typeof urlParams.type === 'string' && typeof urlParams.catalogId === 'string') {
            const { hostname } = UrlUtils.parse(urlParams.transportUrl);
            if (typeof hostname === 'string' && hostname.length > 0) {
                return {
                    action: 'Load',
                    args: {
                        model: 'CatalogWithFilters',
                        args: {
                            request: {
                                base: urlParams.transportUrl,
                                path: {
                                    resource: 'catalog',
                                    type: urlParams.type,
                                    id: urlParams.catalogId,
                                    extra: Array.from(queryParams.entries())
                                }
                            }
                        }
                    }
                };
            }
        } else {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogWithFilters',
                    args: null
                }
            };
        }

        return {
            action: 'Unload'
        };
    }, [urlParams, queryParams]);
    const discover = useModelState({ model: 'discover', action, map, deps: ['ctx'] }) as Discover;
    return [discover, loadNextPage];
};

export default useDiscover;
