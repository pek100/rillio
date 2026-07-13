// Copyright (C) 2017-2024 Smart code 203358507

/**
 * EventModal - clean-room rewrite onto the foundation-kit Dialog.
 *
 * The core event wiring is preserved exactly: useEvents (Ctx GetEvents / DismissEvent)
 * pulls events on mount, the Ready-gated `modal` payload drives visibility, and
 * dismissing marks the event seen by id. Only the presentation moved onto the kit
 * Dialog, keeping the signature floating hero that overflows above the surface.
 *
 * The addon-vs-external CTA branch is unchanged (install-addon deep link vs an
 * external Learn-more link). Layout tidied to the design language: a single accent
 * pill CTA, centered stack, consistent gaps on the Tailwind scale.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui/dialog';
import { Button } from 'rillio/components/ui/button';

const useEvents = require('./useEvents');

const EventModal = () => {
    const { t } = useTranslation();

    const { events, pullEvents, dismissEvent } = useEvents();

    const modal = useMemo(() => {
        return events?.modal?.type === 'Ready' ? events.modal.content : null;
    }, [events]);

    const onClose = useCallback(() => {
        if (modal?.id) {
            dismissEvent(modal.id);
        }
    }, [modal]);

    useEffect(() => {
        pullEvents();
    }, []);

    if (modal === null) {
        return null;
    }

    return (
        <Dialog open onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
            <DialogContent className="w-auto max-w-[45rem] overflow-visible">
                {modal.title ? (
                    <DialogTitle className="sr-only">{modal.title}</DialogTitle>
                ) : (
                    <DialogTitle className="sr-only">{t('NOTIFICATIONS')}</DialogTitle>
                )}
                {modal.imageUrl ? (
                    <img
                        className="pointer-events-none absolute -top-40 left-1/2 size-[30rem] -translate-x-1/2 object-cover max-sm:hidden"
                        src={modal.imageUrl}
                        alt=""
                    />
                ) : null}
                <div className="flex flex-col items-center gap-10 px-8 pt-40 text-center max-sm:pt-6">
                    <div className="flex flex-col items-center gap-3">
                        {modal.title ? (
                            <div className="max-w-md text-xl text-fg">{modal.title}</div>
                        ) : null}
                        {modal.message ? (
                            <div className="text-fg opacity-50">{modal.message}</div>
                        ) : null}
                    </div>
                    {modal?.addon?.name ? (
                        <div className="flex flex-col items-center gap-2">
                            <Puzzle className="size-8 text-primary" />
                            <div className="text-fg">{modal.addon.name}</div>
                        </div>
                    ) : null}
                    {modal?.addon?.manifestUrl ? (
                        <Button
                            className="px-8"
                            href={`#/addons?addon=${encodeURIComponent(modal.addon.manifestUrl)}`}
                            onClick={onClose}
                        >
                            {t('INSTALL_ADDON')}
                        </Button>
                    ) : modal.externalUrl ? (
                        <Button className="px-8" href={modal.externalUrl} target="_blank">
                            {t('LEARN_MORE')}
                        </Button>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default EventModal;
