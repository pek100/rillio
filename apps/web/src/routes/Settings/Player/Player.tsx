import React, { forwardRef } from 'react';
import { usePlatform } from 'rillio/common';
import { Category, Option, Section, SettingsSelect, SettingsSwitch } from '../components';
import ColorInput from './ColorInput';
import usePlayerOptions from './usePlayerOptions';

type Props = {
    profile: Profile,
};

const Player = forwardRef<HTMLDivElement, Props>(({ profile }: Props, ref) => {
    const { shell } = usePlatform();
    const platform = usePlatform();

    const {
        subtitlesSizeSelect,
        subtitlesTextColorInput,
        subtitlesBackgroundColorInput,
        subtitlesOutlineColorInput,
        assSubtitlesStylingToggle,
        audioLanguageSelect,
        surroundSoundToggle,
        seekTimeDurationSelect,
        seekShortTimeDurationSelect,
        playInExternalPlayerSelect,
        nextVideoPopupDurationSelect,
        bingeWatchingToggle,
        nextEpisodePreloadToggle,
        playInBackgroundToggle,
        hardwareDecodingToggle,
        gpuVideoProcessingToggle,
        videoModeSelect,
        pauseOnMinimizeToggle,
    } = usePlayerOptions(profile);

    return (
        <Section ref={ref} label={'SETTINGS_NAV_PLAYER'}>
            {/* Subtitles language deliberately lives on the movie page (the streams
                language picker), not here, one language control drives stream
                priority AND default subtitles. */}
            <Category icon={'subtitles'} label={'SETTINGS_SECTION_SUBTITLES'}>
                <Option label={'SETTINGS_SUBTITLES_SIZE'}>
                    <SettingsSelect
                        {...subtitlesSizeSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR'}>
                    <ColorInput
                        {...subtitlesTextColorInput}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR_BACKGROUND'}>
                    <ColorInput
                        {...subtitlesBackgroundColorInput}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR_OUTLINE'}>
                    <ColorInput
                        {...subtitlesOutlineColorInput}
                    />
                </Option>
            </Category>
            <Category icon={'volume-medium'} label={'SETTINGS_SECTION_AUDIO'}>
                <Option label={'SETTINGS_DEFAULT_AUDIO_TRACK'}>
                    <SettingsSelect
                        {...audioLanguageSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SURROUND_SOUND'}>
                    <SettingsSwitch
                        {...surroundSoundToggle}
                    />
                </Option>
            </Category>
            <Category icon={'remote'} label={'SETTINGS_SECTION_CONTROLS'}>
                <Option label={'SETTINGS_SEEK_KEY'}>
                    <SettingsSelect
                        {...seekTimeDurationSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SEEK_KEY_SHIFT'}>
                    <SettingsSelect
                        {...seekShortTimeDurationSelect}
                    />
                </Option>
                <Option label={'SETTINGS_PLAY_IN_BACKGROUND'}>
                    <SettingsSwitch
                        disabled={true}
                        {...playInBackgroundToggle}
                    />
                </Option>
            </Category>
            <Category icon={'play'} label={'SETTINGS_SECTION_AUTO_PLAY'}>
                <Option label={'AUTO_PLAY'}>
                    <SettingsSwitch
                        {...bingeWatchingToggle}
                    />
                </Option>
                <Option label={'SETTINGS_NEXT_VIDEO_POPUP_DURATION'}>
                    <SettingsSelect
                        {...nextVideoPopupDurationSelect}
                    />
                </Option>
                <Option label={'Offer to preload the next episode'}>
                    <SettingsSwitch
                        {...nextEpisodePreloadToggle}
                    />
                </Option>
            </Category>
            <Category icon={'glasses'} label={'SETTINGS_SECTION_ADVANCED'}>
                <Option label={'SETTINGS_PLAY_IN_EXTERNAL_PLAYER'}>
                    <SettingsSelect
                        {...playInExternalPlayerSelect}
                    />
                </Option>
                {
                    shell.active &&
                        <Option label={'SETTINGS_HWDEC'}>
                            <SettingsSwitch
                                {...hardwareDecodingToggle}
                            />
                        </Option>
                }
                {
                    shell.active && shell.capabilities.gpuVideoProcessing &&
                        <Option label={'SETTINGS_GPU_VIDEO_PROCESSING'}>
                            <SettingsSwitch
                                {...gpuVideoProcessingToggle}
                            />
                        </Option>
                }
                {
                    shell.active && platform.name === 'windows' &&
                        <Option label={'SETTINGS_VIDEO_MODE'}>
                            <SettingsSelect
                                {...videoModeSelect}
                            />
                        </Option>
                }
                {
                    shell.active &&
                        <Option label={'SETTINGS_PAUSE_MINIMIZED'}>
                            <SettingsSwitch
                                {...pauseOnMinimizeToggle}
                            />
                        </Option>
                }
                {
                    shell.active &&
                        <Option label={'SETTINGS_ASS_SUBTITLES_STYLING'}>
                            <SettingsSwitch
                                {...assSubtitlesStylingToggle}
                            />
                        </Option>
                }
            </Category>
        </Section>
    );
});

Player.displayName = 'Player';

export default Player;
