// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useProfile } from 'rillio/common';
import { DEFAULT_STREAMING_SERVER_URL } from 'rillio/common/CONSTANTS';
import useStreamingServer from 'rillio/common/useStreamingServer';
import { Button } from 'rillio/components/ui/button';
import { RadioGroupItem } from 'rillio/components/ui/radio-group';
import { cn } from 'rillio/components/ui/cn';
import useStreamingServerUrls from '../useStreamingServerUrls';

type Props = {
    url: string;
};

const Item = ({ url }: Props) => {
    const { t } = useTranslation();
    const radioId = useId();
    const profile = useProfile();
    const streamingServer = useStreamingServer();
    const { deleteServerUrl, selectServerUrl } = useStreamingServerUrls();

    const selected = useMemo(() => profile.settings.streamingServerUrl === url, [url, profile.settings]);
    const defaultUrl = useMemo(() => url === DEFAULT_STREAMING_SERVER_URL, [url]);

    const handleDelete = useCallback(() => {
        deleteServerUrl(url);
        selected && selectServerUrl(DEFAULT_STREAMING_SERVER_URL);
    }, [url, selected]);

    return (
        <div className="group relative flex justify-between rounded-card border-2 border-transparent bg-surface-hover px-6 py-3 transition-colors hover:brightness-110 max-[640px]:px-4">
            <label htmlFor={radioId} className="flex max-w-[60%] cursor-pointer items-center justify-center gap-4">
                <RadioGroupItem id={radioId} value={url} disabled={selected} className="overflow-visible" />
                <div className="truncate text-fg">{url}</div>
            </label>
            <div className="flex gap-4 pr-16 max-[640px]:pr-12">
                {
                    selected ?
                        <div className="flex items-center justify-center gap-2">
                            <div className={cn(
                                'size-3 rounded-full',
                                streamingServer.settings?.type === 'Ready' && 'bg-success',
                                streamingServer.settings?.type === 'Err' && 'bg-danger',
                            )} />
                            <div className="truncate text-[0.8125rem] text-fg opacity-[0.62]">
                                {
                                    streamingServer.settings === null ?
                                        'NotLoaded'
                                        :
                                        streamingServer.settings.type === 'Ready' ?
                                            t('SETTINGS_SERVER_STATUS_ONLINE')
                                            :
                                            streamingServer.settings.type === 'Err' ?
                                                t('SETTINGS_SERVER_STATUS_ERROR')
                                                :
                                                streamingServer.settings.type
                                }
                            </div>
                        </div>
                        : null
                }
                {
                    !defaultUrl ?
                        <Button
                            variant="ghost"
                            title={t('DELETE')}
                            onClick={handleDelete}
                            className="absolute right-6 top-1/2 w-12 -translate-y-1/2 rounded-card p-0 transition-colors [&:hover_svg]:!text-danger [&:hover_svg]:!opacity-100 max-[640px]:right-4"
                        >
                            <Trash2 className="size-5 text-fg opacity-0 transition-[opacity,color] group-hover:opacity-60 max-[640px]:opacity-60" />
                        </Button>
                        : null
                }
            </div>
        </div>
    );
};

export default Item;
