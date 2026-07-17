// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ModalsContainerContext from './ModalsContainerContext';

type Props = {
    children?: React.ReactNode,
};

const ModalsContainerProvider = ({ children }: Props) => {
    const [container, setContainer] = React.useState<HTMLElement | null>(null);
    // NOT `ref={setContainer}`: React detaches callback refs (calls with null)
    // when a Suspense boundary HIDES a tree, and nulling the state unmounts the
    // children, which re-triggers the suspension - an infinite hide/show loop
    // ("Maximum update depth exceeded", hit on any live navigation into the
    // '*' NotFound route). Keep the last container instead: on a real unmount
    // this whole provider's state dies anyway, and on re-show the ref fires
    // again with the (new) element.
    const onContainer = React.useCallback((el: HTMLElement | null) => {
        if (el !== null) setContainer(el);
    }, []);
    return (
        <ModalsContainerContext.Provider value={container}>
            {container instanceof HTMLElement ? children : null}
            <div ref={onContainer} className={'modals-container'} />
        </ModalsContainerContext.Provider>
    );
};

export default ModalsContainerProvider;
