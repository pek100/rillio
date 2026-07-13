// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';

export type ServicesContextValue = {
    chromecast: any,
};

const ServicesContext = React.createContext<ServicesContextValue>({} as ServicesContextValue);

ServicesContext.displayName = 'ServicesContext';

export default ServicesContext;
