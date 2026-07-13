// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import useModelState from 'rillio/common/useModelState';

const useSearchHistory = (): { items: SearchHistory, clear: () => void } => {
    const core = useCore();
    const { searchHistory: items } = useModelState({ model: 'ctx' } as any) as { searchHistory: SearchHistory };

    const clear = React.useCallback(() => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'ClearSearchHistory',
            },
        });
    }, []);

    return {
        items,
        clear,
    };
};

export default useSearchHistory;
