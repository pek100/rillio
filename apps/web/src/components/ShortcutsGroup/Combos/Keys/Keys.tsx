// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Keys - renders a run of <kbd> chips for one key combo. Clean-room Tailwind; the
 * symbol/localization map, the pure-numeric range collapse (first TO last), and the
 * `+` / `TO` separators are the load-bearing logic and are kept verbatim.
 */

import React, { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
    keys: string[],
};

const kbdClass =
    'flex-none inline-flex h-10 min-w-10 items-center justify-center px-4 ' +
    'text-base font-medium text-fg rounded-[0.25em] bg-[var(--overlay-color)] ' +
    'shadow-[0_4px_0_1px_rgba(255,255,255,0.1)]';

const Keys = ({ keys }: Props) => {
    const { t } = useTranslation();

    const keyLabelMap: Record<string, string> = useMemo(() => ({
        'Shift': `⇧ ${t('SETTINGS_SHORTCUT_SHIFT')}`,
        'Space': t('SETTINGS_SHORTCUT_SPACE'),
        'Ctrl': t('SETTINGS_SHORTCUT_CTRL'),
        'Escape': t('SETTINGS_SHORTCUT_ESC'),
        'Backspace': t('SETTINGS_SHORTCUT_BACKSPACE'),
        'ArrowUp': '↑',
        'ArrowDown': '↓',
        'ArrowLeft': '←',
        'ArrowRight': '→',
    }), [t]);

    const isRange = useMemo(() => {
        return keys.length > 1 && keys.every((key) => !Number.isNaN(parseInt(key)));
    }, [keys]);

    const filteredKeys = useMemo(() => {
        return isRange ? [keys[0], keys[keys.length - 1]] : keys;
    }, [keys, isRange]);

    return (
        <>
            {
                filteredKeys.map((key, index) => (
                    <Fragment key={key}>
                        <kbd className={kbdClass}>
                            {keyLabelMap[key] ?? key.toUpperCase()}
                        </kbd>
                        {
                            index < (filteredKeys.length - 1) && (
                                <div className="flex w-10 items-center justify-center text-base text-fg">
                                    {
                                        isRange ? t('SETTINGS_SHORTCUT_TO') : '+'
                                    }
                                </div>
                            )
                        }
                    </Fragment>
                ))
            }
        </>
    );
};

export default Keys;
