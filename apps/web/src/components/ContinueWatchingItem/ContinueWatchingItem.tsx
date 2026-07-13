// Copyright (C) 2017-2025 Smart code 203358507

/**
 * ContinueWatchingItem - a LibItem specialized for the Board's Continue Watching
 * row. It forces the zoom cursor on the poster and supplies an `onDismissClick`
 * that rewinds the library item and dismisses its notifications, then defers all
 * card rendering and the selectPrevented protocol to LibItem / MetaItem.
 */

import React, { useCallback } from 'react';
import { useCore } from 'rillio/core';
import LibItem from 'rillio/components/LibItem';

type DeepLinks = {
    metaDetailsVideos?: string;
    metaDetailsStreams?: string;
    player?: string;
};

type Props = {
    _id?: string;
    notifications?: { items?: Record<string, unknown[]> };
    deepLinks?: DeepLinks;
    [key: string]: unknown;
};

const ContinueWatchingItem = ({ _id, notifications, ...props }: Props) => {
    const core = useCore();

    const onDismissClick = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        if (typeof _id === 'string') {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'RewindLibraryItem',
                    args: _id
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'DismissNotificationItem',
                    args: _id
                }
            });
        }
    }, [_id, core]);

    return (
        <LibItem
            {...props}
            _id={_id}
            posterChangeCursor={true}
            notifications={notifications}
            onDismissClick={onDismissClick}
        />
    );
};

export default ContinueWatchingItem;
