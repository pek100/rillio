import React, { forwardRef } from 'react';
import { usePlatform } from 'rillio/common';
import { Section, Option, SettingsSelect, SettingsSwitch } from '../components';
import useInterfaceOptions from './useInterfaceOptions';

type Props = {
    profile: Profile,
};

const Interface = forwardRef<HTMLDivElement, Props>(({ profile }: Props, ref) => {
    const { shell } = usePlatform();

    const {
        interfaceLanguageSelect,
        quitOnCloseToggle,
        escExitFullscreenToggle,
        hideSpoilersToggle,
        gamepadSupportToggle,
    } = useInterfaceOptions(profile);

    return (
        <Section ref={ref} label={'INTERFACE'}>
            <Option label={'SETTINGS_UI_LANGUAGE'}>
                <SettingsSelect
                    {...interfaceLanguageSelect}
                />
            </Option>
            {
                shell.active &&
                    <Option label={'SETTINGS_QUIT_ON_CLOSE'}>
                        <SettingsSwitch
                            {...quitOnCloseToggle}
                        />
                    </Option>
            }
            {
                shell.active &&
                    <Option label={'SETTINGS_FULLSCREEN_EXIT'}>
                        <SettingsSwitch
                            {...escExitFullscreenToggle}
                        />
                    </Option>
            }
            <Option label={'SETTINGS_BLUR_UNWATCHED_IMAGE'}>
                <SettingsSwitch
                    {...hideSpoilersToggle}
                />
            </Option>
            <Option label={'SETTINGS_GAMEPAD'}>
                <SettingsSwitch
                    {...gamepadSupportToggle}
                />
            </Option>
        </Section>
    );
});

Interface.displayName = 'Interface';

export default Interface;
