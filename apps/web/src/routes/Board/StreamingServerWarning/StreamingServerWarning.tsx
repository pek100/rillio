// Copyright (C) 2017-2024 Smart code 203358507

/**
 * StreamingServerWarning - the floating island shown on Board when the streaming
 * server errored and the dismissal date has passed. Clean-room rewrite (Phase 3 /
 * Wave B) onto Tailwind + the foundation-kit Button. Board owns the outer placement
 * (passed via className); this component owns the island's flat surface + actions.
 * Board pins it absolutely over the catalog rows, i.e. over POSTER ART, so it takes
 * the house floating-panel glass (black-alpha), not the page's white-lift card.
 * The core dispatch (UpdateSettings with a future streamingServerWarningDismissed)
 * and the withCoreSuspender gate are reused verbatim.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';
import { useCore } from 'rillio/core';
import useProfile from 'rillio/common/useProfile';
import { withCoreSuspender } from 'rillio/common/CoreSuspender';

type Props = {
    className?: string;
};

const ACTION_CLASS = 'h-9 flex-none bg-surface-hover px-4 text-[1.2rem] font-medium text-fg transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97]';

const StreamingServerWarning = ({ className }: Props) => {
    const { t } = useTranslation();
    const core = useCore();
    const profile = useProfile();

    const createDismissalDate = (months: number, years = 0): Date => {
        const dismissalDate = new Date();

        if (months) {
            dismissalDate.setMonth(dismissalDate.getMonth() + months);
        }
        if (years) {
            dismissalDate.setFullYear(dismissalDate.getFullYear() + years);
        }

        return dismissalDate;
    };

    const updateSettings = useCallback((streamingServerWarningDismissed: Date) => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'UpdateSettings',
                args: {
                    ...profile.settings,
                    streamingServerWarningDismissed
                }
            }
        });
    }, [profile.settings]);

    const onLater = useCallback(() => {
        updateSettings(createDismissalDate(1));
    }, [updateSettings]);

    const onDismiss = useCallback(() => {
        updateSettings(createDismissalDate(0, 50));
    }, [updateSettings]);

    return (
        <div className={cn('flex flex-row items-center gap-4 rounded-card border border-line bg-glass-panel p-4 shadow-elevated backdrop-blur-(--glass-blur) max-[640px]:flex-col max-[640px]:px-2 max-[640px]:text-center', className)}>
            <div className="max-h-[2.4em] flex-1 text-[1.2rem] font-medium text-fg">
                {t('SETTINGS_SERVER_UNAVAILABLE')}
            </div>
            <div className="flex gap-3 max-[640px]:justify-around">
                <a
                    href='https://rillio.app'
                    target='_blank'
                    rel='noreferrer'
                >
                    <Button
                        variant="ghost"
                        className={ACTION_CLASS}
                        title={t('SERVICE_INSTALL')}
                        tabIndex={-1}
                    >
                        {t('SERVICE_INSTALL')}
                    </Button>
                </a>
                <Button
                    variant="ghost"
                    className={ACTION_CLASS}
                    title={t('WARNING_STREAMING_SERVER_LATER')}
                    onClick={onLater}
                    tabIndex={-1}
                >
                    {t('WARNING_STREAMING_SERVER_LATER')}
                </Button>
                <Button
                    variant="ghost"
                    className={ACTION_CLASS}
                    title={t('DONT_SHOW_AGAIN')}
                    onClick={onDismiss}
                    tabIndex={-1}
                >
                    {t('DONT_SHOW_AGAIN')}
                </Button>
            </div>
        </div>
    );
};

export default withCoreSuspender(StreamingServerWarning);
