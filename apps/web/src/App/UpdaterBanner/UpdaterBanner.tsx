// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Desktop auto-updater banner. Restyled onto Tailwind tokens + the kit Button /
 * IconButton; the shell event wiring (`autoupdater-show-notif` ->
 * `autoupdater-notif-clicked`) and the player-route suppression are preserved. The
 * banner rises from the bottom edge via the shared Presence (slideUp) primitive.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router';
import { useBinaryState, usePlatform } from 'rillio/common';
import { Presence } from 'rillio/components';
import { Button, IconButton } from 'rillio/components/ui';

type Props = {
    className: string,
};

const UpdaterBanner = ({ className }: Props) => {
    const { t } = useTranslation();
    const { shell } = usePlatform();
    const [visible, show, hide] = useBinaryState(false);
    const isPlayer = useMatch('/player/*');

    const onInstallClick = () => {
        shell.send('autoupdater-notif-clicked');
    };

    useEffect(() => {
        shell.on('autoupdater-show-notif', show);

        return () => {
            shell.off('autoupdater-show-notif', show);
        };
    }, []);

    return (
        <div className={className}>
            <Presence when={visible && !isPlayer} variant={'slideUp'}>
                <div className="relative flex h-16 items-center justify-center gap-4 bg-accent px-4 text-base font-bold text-bg">
                    <div>{t('UPDATER_TITLE')}</div>
                    <Button className="h-10 bg-fg px-4 text-bg" onClick={onInstallClick}>
                        {t('UPDATER_INSTALL_BUTTON')}
                    </Button>
                    <IconButton
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-bg opacity-80 hover:bg-black/10 hover:opacity-100"
                        title={t('BUTTON_CLOSE')}
                        onClick={hide}
                    >
                        <X className="size-5" />
                    </IconButton>
                </div>
            </Presence>
        </div>
    );
};

export default UpdaterBanner;
