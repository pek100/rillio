// Copyright (C) 2017-2024 Smart code 203358507

import React, { ChangeEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'rillio/components/ui/button';
import { Input } from 'rillio/components/ui/input';

type Props = {
    onCancel: () => void;
    handleAddUrl: (url: string) => void;
};

const AddItem = ({ onCancel, handleAddUrl }: Props) => {
    const { t } = useTranslation();
    const [inputValue, setInputValue] = useState('');

    const handleValueChange = useCallback(({ target }: ChangeEvent<HTMLInputElement>) => {
        setInputValue(target.value);
    }, []);

    const onSubmit = useCallback(() => {
        handleAddUrl(inputValue);
    }, [inputValue]);

    return (
        <div className="relative flex justify-between rounded-card border-2 border-transparent bg-surface-hover px-6 py-1.5 transition-colors hover:brightness-110 max-[640px]:px-2">
            <Input
                className="w-[70%]"
                value={inputValue}
                onChange={handleValueChange}
                onSubmit={onSubmit}
                placeholder={t('SETTINGS_SERVER_ADD_URL_PLACEHOLDER')}
            />
            <div className="flex gap-1">
                <Button
                    variant="ghost"
                    onClick={onSubmit}
                    className="flex w-12 items-center justify-center rounded-card bg-transparent p-1 opacity-60 hover:bg-surface-hover hover:opacity-100 [&:hover_svg]:text-success"
                >
                    <Icon name={'checkmark'} className="size-5 text-fg" />
                </Button>
                <Button
                    variant="ghost"
                    onClick={onCancel}
                    className="flex w-12 items-center justify-center rounded-card bg-transparent p-1 opacity-60 hover:bg-surface-hover hover:opacity-100 [&:hover_svg]:text-danger"
                >
                    <Icon name={'close'} className="size-5 text-fg" />
                </Button>
            </div>
        </div>
    );
};

export default AddItem;
