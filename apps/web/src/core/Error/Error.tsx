// Copyright (C) 2017-2023 Smart code 203358507

/**
 * Core-init failure screen. Ported onto Tailwind tokens + the kit Button / Dialog.
 * Both recovery actions are kept: Reload (safe) and Clear data. Clearing local
 * storage is a one-click, irreversible data-loss footgun (it is the ONLY copy of the
 * user's profile / library / settings), so it now sits behind an explicit confirm
 * Dialog rather than firing on a single click.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import Image from 'rillio/components/Image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from 'rillio/components/ui';

type Props = {
    message: string,
};

const Error = ({ message }: Props) => {
    const { t } = useTranslation();
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    const reload = React.useCallback(() => {
        window.location.reload();
    }, []);

    const clearData = React.useCallback(() => {
        window.localStorage.clear();
        window.location.reload();
    }, []);

    return (
        <div className="relative flex size-full flex-col items-center justify-center gap-4">
            <Image
                className="h-48 w-48 flex-none object-contain object-center opacity-90"
                src={require('/assets/images/empty.svg')}
                alt={' '}
            />
            <div className="flex flex-col items-center justify-center gap-2">
                <div className="text-[2rem] text-fg">
                    {t('GENERIC_ERROR_MESSAGE')}
                </div>
                <div className="line-clamp-5 max-w-[40rem] text-center text-2xl text-fg-muted">
                    {message}
                </div>
            </div>
            <div className="mx-8 mt-4 flex flex-none flex-row flex-wrap items-center justify-center gap-4">
                <Button className="h-14 min-w-32 px-10" title={t('RELOAD')} onClick={reload}>
                    {t('RELOAD')}
                </Button>
                <Button
                    variant="ghost"
                    className="h-14 min-w-32 bg-surface-hover px-10 text-danger hover:brightness-110"
                    title={t('CLEAR_DATA')}
                    onClick={() => setConfirmOpen(true)}
                >
                    {t('CLEAR_DATA')}
                </Button>
            </div>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="max-w-md gap-6">
                    <DialogHeader>
                        <DialogTitle>{t('CLEAR_DATA')}</DialogTitle>
                        <DialogDescription>
                            This erases the profile, library and settings stored on this device. It cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" className="bg-surface-hover text-fg hover:brightness-110" onClick={() => setConfirmOpen(false)}>
                            {t('BUTTON_CANCEL')}
                        </Button>
                        <Button className="bg-danger text-fg hover:brightness-110" onClick={clearData}>
                            {t('CLEAR_DATA')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Error;
