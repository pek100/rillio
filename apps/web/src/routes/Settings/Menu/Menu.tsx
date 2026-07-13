// Copyright (C) 2017-2024 Smart code 203358507

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatform } from 'rillio/common';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';
import { SECTIONS } from '../constants';

type Props = {
    selected: string,
    streamingServer: StreamingServer,
    onSelect: (sectionId: string) => void,
};

const MenuButton = ({ id, label, selected, onSelect }: { id: string, label: string, selected: boolean, onSelect: (sectionId: string) => void }) => (
    <Button
        variant="ghost"
        title={label}
        onClick={() => onSelect(id)}
        className={cn(
            'mb-1.5 h-11 flex-none justify-start self-stretch px-5 text-[1.05rem] font-medium text-fg opacity-[0.62]',
            'hover:bg-surface-hover hover:opacity-100 active:scale-[0.98]',
            selected && 'bg-surface-hover font-semibold text-accent opacity-100',
        )}
    >
        {label}
    </Button>
);

const Menu = ({ selected, streamingServer, onSelect }: Props) => {
    const { t } = useTranslation();
    const { shell } = usePlatform();
    const platform = usePlatform();

    const settings = useMemo(() => (
        streamingServer?.settings?.type === 'Ready' ?
            streamingServer.settings.content as StreamingServerSettings : null
    ), [streamingServer?.settings]);

    return (
        <div className="flex w-72 flex-none flex-col self-stretch px-6 py-12 max-[1000px]:hidden">
            <MenuButton id={SECTIONS.GENERAL} label={t('SETTINGS_NAV_GENERAL')} selected={selected === SECTIONS.GENERAL} onSelect={onSelect} />
            <MenuButton id={SECTIONS.INTERFACE} label={t('INTERFACE')} selected={selected === SECTIONS.INTERFACE} onSelect={onSelect} />
            <MenuButton id={SECTIONS.PLAYER} label={t('SETTINGS_NAV_PLAYER')} selected={selected === SECTIONS.PLAYER} onSelect={onSelect} />
            <MenuButton id={SECTIONS.STREAMING} label={t('SETTINGS_NAV_STREAMING')} selected={selected === SECTIONS.STREAMING} onSelect={onSelect} />
            {
                !platform.isMobile &&
                    <MenuButton id={SECTIONS.SHORTCUTS} label={t('SETTINGS_NAV_SHORTCUTS')} selected={selected === SECTIONS.SHORTCUTS} onSelect={onSelect} />
            }

            <div className="flex-1" />

            <div className="my-2 flex-none truncate text-[0.8125rem] text-fg opacity-40" title={process.env.VERSION}>
                {t('SETTINGS_APP_VERSION')}: {process.env.VERSION}
            </div>
            <div className="my-2 flex-none truncate text-[0.8125rem] text-fg opacity-40" title={process.env.COMMIT_HASH}>
                {t('SETTINGS_BUILD_VERSION')}: {process.env.COMMIT_HASH}
            </div>
            {
                settings?.serverVersion &&
                    <div className="my-2 flex-none truncate text-[0.8125rem] text-fg opacity-40" title={settings.serverVersion}>
                        {t('SETTINGS_SERVER_VERSION')}: {settings.serverVersion}
                    </div>
            }
            {
                typeof shell.state.version === 'string' &&
                    <div className="my-2 flex-none truncate text-[0.8125rem] text-fg opacity-40" title={shell.state.version}>
                        {t('SETTINGS_SHELL_VERSION')}: {shell.state.version}
                    </div>
            }
        </div>
    );
};

export default Menu;
