import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router';
import { useBinaryState, usePlatform } from 'rillio/common';
import { Button, Presence } from 'rillio/components';
import styles from './UpdaterBanner.less';

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
                <div className={styles['updater-banner']}>
                    <div className={styles['label']}>
                        { t('UPDATER_TITLE') }
                    </div>
                    <Button className={styles['button']} onClick={onInstallClick}>
                        { t('UPDATER_INSTALL_BUTTON') }
                    </Button>
                    <Button className={styles['close']} onClick={hide}>
                        <X className={styles['icon']} />
                    </Button>
                </div>
            </Presence>
        </div>
    );
};

export default UpdaterBanner;
