// Copyright (C) 2017-2023 Smart code 203358507

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { useShortcuts } from 'rillio/common';
import { Button, ShortcutsGroup } from 'rillio/components';
import styles from './styles.less';

type Props = {
    onClose: () => void,
};

const ShortcutsModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const { grouped } = useShortcuts();
    const titleId = React.useId();
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        containerRef.current?.focus();

        const onKeyDown = ({ key }: KeyboardEvent) => {
            key === 'Escape' && onClose();
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, []);

    return createPortal((
        <div className={styles['shortcuts-modal']}>
            <div className={styles['backdrop']} onClick={onClose} />

            <div className={styles['container']} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={containerRef}>
                <div className={styles['header']}>
                    <div className={styles['title']} id={titleId}>
                        {t('SETTINGS_NAV_SHORTCUTS')}
                    </div>

                    <Button className={styles['close-button']} title={t('BUTTON_CLOSE')} onClick={onClose}>
                        <Icon className={styles['icon']} name={'close'} />
                    </Button>
                </div>

                <div className={styles['content']}>
                    {
                        grouped.map(({ name, label, shortcuts }) => (
                            <ShortcutsGroup
                                key={name}
                                label={label}
                                shortcuts={shortcuts}
                            />
                        ))
                    }
                </div>
            </div>
        </div>
    ), document.body);
};

export default ShortcutsModal;
