// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';

type MetaExtensionTab = {
    id: string;
    label: string;
    logo: string;
    icon: string;
    onClick: () => void;
};

const useMetaExtensionTabs = (metaExtensions: any[]): [MetaExtensionTab[], any, () => void] => {
    const tabs = React.useMemo(() => {
        return metaExtensions
            .map((extension: any) => ({
                id: extension.url,
                label: extension.addon.manifest.name,
                logo: extension.addon.manifest.logo,
                icon: 'addons',
                onClick: () => setSelected(extension)
            }));
    }, [metaExtensions]);
    const [selected, setSelected] = React.useState<any>(null);
    const clear = React.useCallback(() => {
        setSelected(null);
    }, []);
    return [tabs, selected, clear];
};

export default useMetaExtensionTabs;
