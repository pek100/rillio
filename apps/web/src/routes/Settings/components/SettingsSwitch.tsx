// Copyright (C) 2017-2024 Smart code 203358507

/**
 * SettingsSwitch - adapts the Settings option hooks' toggle bundle (`{checked, onClick}`)
 * to the foundation-kit Radix Switch (`checked` + `onCheckedChange`). onClick ignores its
 * argument and simply dispatches the toggle, so it maps cleanly onto onCheckedChange. Every
 * settings toggle is tabIndex=-1 (the row owns focus), matching the legacy Toggle.
 */

import React from 'react';
import { Switch } from 'rillio/components/ui/switch';

type Props = {
    className?: string,
    checked: boolean,
    disabled?: boolean,
    onClick: () => void,
};

const SettingsSwitch = ({ className, checked, disabled, onClick }: Props) => (
    <Switch
        className={className}
        checked={checked}
        disabled={disabled}
        tabIndex={-1}
        onCheckedChange={onClick}
    />
);

export default SettingsSwitch;
