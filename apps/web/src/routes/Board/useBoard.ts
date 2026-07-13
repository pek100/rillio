// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useCore } from 'rillio/core';
import { useModelState } from 'rillio/common';

const useBoard = (): [Board, (range: { start: number; end: number }) => void] => {
    const core = useCore();
    const action = React.useMemo(() => ({
        action: 'Load',
        args: {
            model: 'CatalogsWithExtra',
            args: { extra: [] }
        }
    }), []);
    const loadRange = React.useCallback((range: { start: number; end: number }) => {
        core.transport.dispatch({
            action: 'CatalogsWithExtra',
            args: {
                action: 'LoadRange',
                args: range
            }
        }, 'board');
    }, []);
    const board = useModelState({ model: 'board', action }) as Board;
    return [board, loadRange];
};

export default useBoard;
