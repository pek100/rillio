// Copyright (C) 2017-2023 Smart code 203358507

/**
 * Keyboard-shortcuts reference modal. Ported onto the kit Dialog: Radix gives the
 * focus-trap, Escape-to-close, scroll-lock, outside-click dismiss and focus restore
 * for free, so the hand-rolled portal + backdrop + keydown listener retire. Open is
 * controlled (the modal is mounted while its binary state is open), never a
 * DialogTrigger. ShortcutsGroup (its own cluster) is reused verbatim.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcuts } from 'rillio/common';
import { ShortcutsGroup } from 'rillio/components';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui';

type Props = {
    onClose: () => void,
};

const ShortcutsModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const { grouped } = useShortcuts();

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent className="flex max-h-[80vh] max-w-[min(80vw,64rem)] flex-col gap-6 overflow-y-auto">
                <DialogTitle className="pr-8 text-2xl font-semibold">
                    {t('SETTINGS_NAV_SHORTCUTS')}
                </DialogTitle>

                <div className="flex flex-row flex-wrap gap-x-12 gap-y-8 overflow-visible">
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
            </DialogContent>
        </Dialog>
    );
};

export default ShortcutsModal;
