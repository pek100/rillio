// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Combos - a wrap-flex, right-justified run of key combos separated by a localized
 * OR. Clean-room Tailwind. The combos[][] shape (array of combos, each an array of
 * key strings) is unchanged.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import Keys from './Keys';

type Props = {
    combos: string[][],
};

const Combos = ({ combos }: Props) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-wrap justify-end gap-y-4">
            {
                combos.map((keys, index) => (
                    <div className="flex" key={index}>
                        <Keys keys={keys} />
                        {
                            index < (combos.length - 1) && (
                                <div className="flex w-14 items-center justify-center text-base text-fg opacity-60">
                                    { t('SETTINGS_SHORTCUT_OR') }
                                </div>
                            )
                        }
                    </div>
                ))
            }
        </div>
    );
};

export default Combos;
