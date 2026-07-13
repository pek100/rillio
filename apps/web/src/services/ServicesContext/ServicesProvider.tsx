// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ServicesContext, { ServicesContextValue } from './ServicesContext';

type Props = {
    services?: ServicesContextValue,
    children?: React.ReactNode,
};

const ServicesProvider = ({ services = {} as ServicesContextValue, children }: Props) => {
    return (
        <ServicesContext.Provider value={services}>
            {children}
        </ServicesContext.Provider>
    );
};

export default ServicesProvider;
