// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ModalsContainerContext from './ModalsContainerContext';

const useModalsContainer = (): HTMLElement | null => {
    return React.useContext(ModalsContainerContext);
};

export default useModalsContainer;
