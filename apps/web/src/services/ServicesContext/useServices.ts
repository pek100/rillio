// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ServicesContext, { ServicesContextValue } from './ServicesContext';

const useServices = (): ServicesContextValue => {
    return React.useContext(ServicesContext);
};

export default useServices;
