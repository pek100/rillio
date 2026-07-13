// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import { useModelState } from 'rillio/common';

const map = (dataExport: any) => ({
    ...dataExport,
    exportUrl: dataExport !== null && dataExport.exportUrl !== null && dataExport.exportUrl.type === 'Ready' ?
        dataExport.exportUrl.content
        :
        null
});

const useDataExport = (): [DataExport, () => void] => {
    const core = useCore();
    const loadDataExport = React.useCallback(() => {
        core.transport.dispatch({
            action: 'Load',
            args: {
                model: 'DataExport',
            }
        }, 'data_export');
    }, []);
    const dataExport = useModelState({ model: 'data_export', action: undefined, map }) as DataExport;
    return [
        dataExport,
        loadDataExport
    ];
};

export default useDataExport;
