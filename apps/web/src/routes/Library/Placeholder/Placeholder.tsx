// Copyright (C) 2017-2025 Smart code 203358507

/**
 * Library logged-out placeholder. Clean-room Tailwind rewrite on the foundation-kit
 * Button; same layout (title, illustration, two feature points, log-in CTA). Kept
 * exported for the route family; presentational only.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'rillio/components/ui/button';
import Image from 'rillio/components/Image';

const Placeholder = () => {
    const { t } = useTranslation();

    return (
        <div className="relative flex min-h-full w-full flex-col items-center justify-center overflow-y-auto max-[1000px]:px-8 max-[1000px]:py-4 max-[640px]:px-8 max-[640px]:py-4">
            <div className="mb-4 text-center text-[1.75rem] font-semibold text-fg opacity-50 max-[1000px]:mb-0">
                {t('LIBRARY_NOT_LOGGED_IN')}
            </div>
            <div className="py-6 max-[1000px]:py-4">
                <Image
                    className="h-full max-h-56 object-contain max-[1000px]:max-h-40"
                    src={require('/assets/images/library-placeholder.svg')}
                    alt={' '}
                />
            </div>
            <div className="mb-4 flex flex-row items-center gap-16 max-[640px]:flex-col max-[640px]:gap-4">
                <div className="flex w-72 flex-row items-center gap-6">
                    <Icon className="size-[3.25rem] flex-none text-fg opacity-30" name={'cloud-library'} />
                    <div className="flex-auto text-[1.1rem] font-medium text-fg opacity-90 max-[640px]:text-base">
                        {t('NOT_LOGGED_IN_CLOUD')}
                    </div>
                </div>
                <div className="flex w-72 flex-row items-center gap-6">
                    <Icon className="size-[3.25rem] flex-none text-fg opacity-30" name={'actors'} />
                    <div className="flex-auto text-[1.1rem] font-medium text-fg opacity-90 max-[640px]:text-base">
                        {t('NOT_LOGGED_IN_RECOMMENDATIONS')}
                    </div>
                </div>
            </div>
            <div className="my-4 max-[1000px]:mt-4 max-[1000px]:mb-0">
                <Button className="h-10 px-12 text-base max-[640px]:w-full" href={'#/intro?form=login'}>
                    {t('LOG_IN')}
                </Button>
            </div>
        </div>
    );
};

export default Placeholder;
