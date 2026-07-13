// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import useModelState from 'rillio/common/useModelState';

const useAddonDetails = (transportUrl?: string) => {
    const action = React.useMemo(() => {
        if (typeof transportUrl === 'string') {
            return {
                action: 'Load',
                args: {
                    model: 'AddonDetails',
                    args: {
                        transportUrl
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [transportUrl]);
    return useModelState({ model: 'addon_details', action });
};

export default useAddonDetails;
