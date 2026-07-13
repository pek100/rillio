// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useNavigate } from 'react-router';
import { withCoreSuspender, useStreamingServer } from 'rillio/common';
import { toPath } from 'rillio-router';

const DeepLinkHandler = () => {
    const navigate = useNavigate();
    const streamingServer = useStreamingServer();
    React.useEffect(() => {
        // The streaming-server torrent slot is a dynamic [url, Loadable] tuple at
        // runtime; the shared hook types it more loosely, so read it as `any` here.
        const torrent = streamingServer.torrent as any;
        if (torrent !== null) {
            const [, { type, content }] = torrent;
            if (type === 'Ready') {
                const [, deepLinks] = content;
                if (typeof deepLinks.metaDetailsVideos === 'string') {
                    navigate(toPath(deepLinks.metaDetailsVideos));
                }
            }
        }
    }, [streamingServer.torrent]);
    return null;
};

export default withCoreSuspender(DeepLinkHandler);
