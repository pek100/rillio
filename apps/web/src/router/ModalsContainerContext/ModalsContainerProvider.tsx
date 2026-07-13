// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ModalsContainerContext from './ModalsContainerContext';

type Props = {
    children?: React.ReactNode,
};

const ModalsContainerProvider = ({ children }: Props) => {
    const [container, setContainer] = React.useState<HTMLElement | null>(null);
    return (
        <ModalsContainerContext.Provider value={container}>
            {container instanceof HTMLElement ? children : null}
            <div ref={setContainer} className={'modals-container'} />
        </ModalsContainerContext.Provider>
    );
};

export default ModalsContainerProvider;
