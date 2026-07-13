// Copyright (C) 2017-2025 Smart code 203358507

/**
 * ShortcutsGroup - a titled column of keyboard-shortcut rows (Settings). Clean-room
 * Tailwind; the layout (baseline-aligned label + right-justified Combos) is bespoke
 * and stays custom. i18n labels are reused verbatim.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'rillio/components/ui/cn';
import Combos from './Combos';

type Props = {
    className?: string,
    label: string,
    shortcuts: Shortcut[],
};

const ShortcutsGroup = ({ className, label, shortcuts }: Props) => {
    const { t } = useTranslation();

    return (
        <div className={cn('flex w-[35rem] flex-1 flex-col gap-8', className)}>
            <div className="flex flex-none text-base font-normal text-fg opacity-60">
                {t(label)}
            </div>

            <div className="flex flex-col gap-8">
                {
                    shortcuts.map(({ name, label, combos }) => (
                        <div className="flex items-baseline justify-between gap-8" key={name}>
                            <div className="overflow-hidden text-ellipsis text-base text-fg">
                                {t(label)}
                            </div>
                            <Combos combos={combos} />
                        </div>
                    ))
                }
            </div>
        </div>
    );
};

export default ShortcutsGroup;
