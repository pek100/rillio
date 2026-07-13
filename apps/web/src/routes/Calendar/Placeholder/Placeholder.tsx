// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Not-logged-in Calendar placeholder (clean-room Tailwind rewrite of Placeholder.less).
 * A centered pitch for the calendar/notifications features with a Log in CTA.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone, Calendar } from 'lucide-react';
import { Image } from 'rillio/components';
import { Button } from 'rillio/components/ui/button';

const Placeholder = () => {
    const { t } = useTranslation();

    return (
        <div className={'flex min-h-full w-full flex-col items-center justify-center overflow-y-auto max-[1000px]:px-8 max-[1000px]:py-4'}>
            <div className={'mb-4 text-center text-[1.75rem] font-semibold text-fg-muted'}>
                {t('CALENDAR_NOT_LOGGED_IN')}
            </div>
            <div className={'py-6'}>
                <Image
                    className={'h-full max-h-56 object-contain'}
                    src={require('/assets/images/calendar-placeholder.svg')}
                    alt={' '}
                />
            </div>
            <div className={'mb-4 flex flex-row items-center gap-16 max-[640px]:flex-col max-[640px]:gap-4'}>
                <div className={'flex w-72 flex-row items-center gap-6'}>
                    <Megaphone className={'size-[3.25rem] flex-none text-fg-subtle'} />
                    <div className={'flex-auto text-base font-medium text-fg'}>
                        {t('NOT_LOGGED_IN_NOTIFICATIONS')}
                    </div>
                </div>
                <div className={'flex w-72 flex-row items-center gap-6'}>
                    <Calendar className={'size-[3.25rem] flex-none text-fg-subtle'} />
                    <div className={'flex-auto text-base font-medium text-fg'}>
                        {t('NOT_LOGGED_IN_CALENDAR')}
                    </div>
                </div>
            </div>
            <div className={'my-4 max-[640px]:w-full'}>
                <Button className={'h-11 px-20 text-sm font-semibold max-[640px]:w-full'} href={'#/intro?form=login'}>
                    {t('LOG_IN')}
                </Button>
            </div>
        </div>
    );
};

export default Placeholder;
