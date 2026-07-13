import React, { forwardRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { useToast } from 'rillio/common';
import { Button } from 'rillio/components/ui/button';
import { Section, Option, SettingsSelect, SettingsSwitch } from '../components';
import URLsManager from './URLsManager';
import useStreamingOptions from './useStreamingOptions';
import useFasterDownloads from './useFasterDownloads';

type Props = {
    profile: Profile,
    streamingServer: StreamingServer,
};

const Streaming = forwardRef<HTMLDivElement, Props>(({ profile, streamingServer }: Props, ref) => {
    const { t } = useTranslation();
    const toast = useToast();

    const {
        streamingServerRemoteUrlInput,
        remoteEndpointSelect,
        cacheSizeSelect,
        torrentProfileSelect,
        transcodingProfileSelect,
    } = useStreamingOptions(streamingServer);

    const fasterDownloads = useFasterDownloads(profile.settings.streamingServerUrl);

    const onCopyRemoteUrl = useCallback(() => {
        if (streamingServer.remoteUrl) {
            navigator.clipboard.writeText(streamingServer.remoteUrl);

            toast.show({
                type: 'success',
                title: t('SETTINGS_REMOTE_URL_COPIED'),
                timeout: 2500,
            });
        }
    }, [streamingServer.remoteUrl]);

    return (
        <Section ref={ref} label={'SETTINGS_NAV_STREAMING'}>
            <URLsManager />
            {
                streamingServerRemoteUrlInput.value !== null &&
                    <Option label={'SETTINGS_REMOTE_URL'}>
                        <div className="flex w-full items-center gap-4 overflow-hidden">
                            <div className="flex-auto truncate px-4 text-fg" title={streamingServerRemoteUrlInput.value}>
                                {streamingServerRemoteUrlInput.value}
                            </div>
                            <Button
                                variant="ghost"
                                title={t('SETTINGS_COPY_REMOTE_URL')}
                                onClick={onCopyRemoteUrl}
                                className="size-10 flex-none rounded-full bg-surface-hover p-0 text-fg opacity-100 hover:bg-surface-hover hover:brightness-110 active:scale-95"
                            >
                                <Icon className="size-4 text-fg" name={'link'} />
                            </Button>
                        </div>
                    </Option>
            }
            {
                profile.auth !== null && profile.auth.user !== null && remoteEndpointSelect !== null &&
                    <Option label={'SETTINGS_HTTPS_ENDPOINT'}>
                        <SettingsSelect
                            {...remoteEndpointSelect}
                        />
                    </Option>
            }
            {
                cacheSizeSelect !== null &&
                    <Option label={'SETTINGS_SERVER_CACHE_SIZE'}>
                        <SettingsSelect
                            {...cacheSizeSelect}
                        />
                    </Option>
            }
            {
                torrentProfileSelect !== null &&
                    <Option label={'SETTINGS_SERVER_TORRENT_PROFILE'}>
                        <SettingsSelect
                            {...torrentProfileSelect}
                        />
                    </Option>
            }
            {
                fasterDownloads.available &&
                    <Option label={'SETTINGS_FASTER_DOWNLOADS'}>
                        <SettingsSwitch
                            className="ml-auto"
                            checked={fasterDownloads.enabled}
                            onClick={fasterDownloads.toggle}
                        />
                    </Option>
            }
            {
                transcodingProfileSelect !== null &&
                    <Option label={'SETTINGS_TRANSCODE_PROFILE'}>
                        <SettingsSelect
                            {...transcodingProfileSelect}
                        />
                    </Option>
            }
        </Section>
    );
});

Streaming.displayName = 'Streaming';

export default Streaming;
