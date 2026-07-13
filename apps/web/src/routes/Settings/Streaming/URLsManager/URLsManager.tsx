// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw } from 'lucide-react';
import { useProfile } from 'rillio/common';
import { Button } from 'rillio/components/ui/button';
import { RadioGroup } from 'rillio/components/ui/radio-group';
import Item from './Item';
import AddItem from './AddItem';
import useStreamingServerUrls from './useStreamingServerUrls';

const URLsManager = () => {
    const { t } = useTranslation();
    const profile = useProfile();
    const [addMode, setAddMode] = useState(false);
    const { streamingServerUrls, addServerUrl, reloadServer, selectServerUrl } = useStreamingServerUrls();

    const onAdd = () => {
        setAddMode(true);
    };

    const onCancel = () => {
        setAddMode(false);
    };

    const handleAddUrl = useCallback((url: string) => {
        addServerUrl(url);
        setAddMode(false);
    }, []);

    return (
        <div className="relative mb-8 flex w-full max-w-[35rem] flex-col">
            <div className="flex items-center justify-between px-12">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg opacity-[0.62]">{t('URL')}</div>
                <div className="pr-12 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg opacity-[0.62]">{t('STATUS')}</div>
            </div>
            <div className="flex flex-col gap-4 py-6">
                <RadioGroup
                    className="flex flex-col gap-4"
                    value={profile.settings.streamingServerUrl}
                    onValueChange={selectServerUrl}
                >
                    {
                        streamingServerUrls.map((item: StreamingServerUrl) => (
                            <Item key={item.url} url={item.url} />
                        ))
                    }
                </RadioGroup>
                {
                    addMode ?
                        <AddItem onCancel={onCancel} handleAddUrl={handleAddUrl} />
                        : null
                }
            </div>
            <div className="flex justify-between">
                <Button
                    variant="ghost"
                    title={t('SETTINGS_SERVER_ADD_URL')}
                    onClick={onAdd}
                    className="bg-surface-hover px-6 py-2 text-fg hover:brightness-110 active:scale-[0.98]"
                >
                    <Plus className="size-4 text-fg" />
                    {t('SETTINGS_SERVER_ADD_URL')}
                </Button>
                <Button
                    variant="ghost"
                    title={t('RELOAD')}
                    onClick={reloadServer}
                    className="bg-surface-hover px-6 py-2 text-fg hover:brightness-110 active:scale-[0.98]"
                >
                    <RotateCcw className="size-4 text-fg" />
                    <div>{t('RELOAD')}</div>
                </Button>
            </div>
        </div>
    );
};

export default URLsManager;
