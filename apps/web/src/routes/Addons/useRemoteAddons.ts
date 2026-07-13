// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useModelState } from 'rillio/common';

const useRemoteAddons = (urlParams: UrlParams): RemoteAddons => {
    const action = React.useMemo(() => {
        if (typeof urlParams.type === 'string' && typeof urlParams.transportUrl === 'string' && typeof urlParams.catalogId === 'string') {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogWithFilters',
                    args: {
                        request: {
                            base: urlParams.transportUrl,
                            path: {
                                resource: 'addon_catalog',
                                type: urlParams.type,
                                id: urlParams.catalogId,
                                extra: []
                            }
                        }
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [urlParams]);
    return useModelState({ model: 'remote_addons', action, deps: ['ctx'] }) as RemoteAddons;
};

export default useRemoteAddons;
