// Copyright (C) 2017-2023 Smart code 203358507

import { useCore } from 'rillio/core';
import useModelState from 'rillio/common/useModelState';

const map = (ctx: any) => ({
    ...ctx.events,
});

const useEvents = () => {
    const core = useCore();

    const pullEvents = () => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'GetEvents',
            },
        });
    };

    const dismissEvent = (id: string) => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'DismissEvent',
                args: id,
            },
        });
    };

    // useModelState is a legacy, dynamically-typed helper whose inferred param
    // marks `action` required; this ctx read has none, so relax the arg.
    const events = useModelState({ model: 'ctx', map } as any);
    return { events, pullEvents, dismissEvent };
};

export default useEvents;
