// Copyright (C) 2017-2023 Smart code 203358507

const useModelState = require('rillio/common/useModelState');

const useStreamingServer = () => {
    return useModelState({ model: 'streaming_server' });
};

module.exports = useStreamingServer;
