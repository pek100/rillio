// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { ModalsContainerProvider } from '../ModalsContainerContext';
import { RouteFocusedProvider } from 'rillio/common/useRouteFocused';

type Props = {
    component?: React.ReactNode,
    focused: boolean,
};

const Route = ({ component, focused }: Props) => {
    return (
        <div className={'route-container'}>
            <RouteFocusedProvider value={focused}>
                <ModalsContainerProvider>
                    <div className={'route-content'}>
                        {component}
                    </div>
                </ModalsContainerProvider>
            </RouteFocusedProvider>
        </div>
    );
};

export default Route;
