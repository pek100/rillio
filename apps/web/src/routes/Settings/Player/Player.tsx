import React, { forwardRef } from 'react';
import { ColorInput, MultiselectMenu, Toggle } from 'rillio/components';
import { usePlatform } from 'rillio/common';
import { Category, Option, Section } from '../components';
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
                    <MultiselectMenu
                        className={'multiselect'}
                        {...subtitlesSizeSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR'}>
                    <ColorInput
                        className={'color-input'}
                        {...subtitlesTextColorInput}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR_BACKGROUND'}>
                    <ColorInput
                        className={'color-input'}
                        {...subtitlesBackgroundColorInput}
                    />
                </Option>
                <Option label={'SETTINGS_SUBTITLES_COLOR_OUTLINE'}>
                    <ColorInput
                        className={'color-input'}
                        {...subtitlesOutlineColorInput}
                    />
                </Option>
            </Category>
            <Category icon={'volume-medium'} label={'SETTINGS_SECTION_AUDIO'}>
                <Option label={'SETTINGS_DEFAULT_AUDIO_TRACK'}>
                    <MultiselectMenu
                        className={'multiselect'}
                        {...audioLanguageSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SURROUND_SOUND'}>
                    <Toggle
                        tabIndex={-1}
                        {...surroundSoundToggle}
                    />
                </Option>
            </Category>
            <Category icon={'remote'} label={'SETTINGS_SECTION_CONTROLS'}>
                <Option label={'SETTINGS_SEEK_KEY'}>
                    <MultiselectMenu
                        className={'multiselect'}
                        {...seekTimeDurationSelect}
                    />
                </Option>
                <Option label={'SETTINGS_SEEK_KEY_SHIFT'}>
                    <MultiselectMenu
                        className={'multiselect'}
                        {...seekShortTimeDurationSelect}
                    />
                </Option>
                <Option label={'SETTINGS_PLAY_IN_BACKGROUND'}>
                    <Toggle
                        disabled={true}
                        tabIndex={-1}
                        {...playInBackgroundToggle}
                    />
                </Option>
            </Category>
            <Category icon={'play'} label={'SETTINGS_SECTION_AUTO_PLAY'}>
                <Option label={'AUTO_PLAY'}>
                    <Toggle
                        tabIndex={-1}
                        {...bingeWatchingToggle}
                    />
                </Option>
                <Option label={'SETTINGS_NEXT_VIDEO_POPUP_DURATION'}>
                    <MultiselectMenu
                        className={'multiselect'}
                        {...nextVideoPopupDurationSelect}
                    />
                </Option>
                <Option label={'Offer to preload the next episode'}>
                    <Toggle
                        tabIndex={-1}
                        {...nextEpisodePreloadToggle}
                    />
                </Option>
            </Category>
            <Category icon={'glasses'} label={'SETTINGS_SECTION_ADVANCED'}>
                <Option label={'SETTINGS_PLAY_IN_EXTERNAL_PLAYER'}>
                    <MultiselectMenu
                        className={'multiselect'}
                        {...playInExternalPlayerSelect}
                    />
                </Option>
                {
                    shell.active &&
                        <Option label={'SETTINGS_HWDEC'}>
                            <Toggle
                                tabIndex={-1}
                                {...hardwareDecodingToggle}
                            />
                        </Option>
                }
                {
                    shell.active && shell.capabilities.gpuVideoProcessing &&
                        <Option label={'SETTINGS_GPU_VIDEO_PROCESSING'}>
                            <Toggle
                                tabIndex={-1}
                                {...gpuVideoProcessingToggle}
                            />
                        </Option>
                }
                {
                    shell.active && platform.name === 'windows' &&
                        <Option label={'SETTINGS_VIDEO_MODE'}>
                            <MultiselectMenu
                                className={'multiselect'}
                                {...videoModeSelect}
                            />
                        </Option>
                }
                {
                    shell.active &&
                        <Option label={'SETTINGS_PAUSE_MINIMIZED'}>
                            <Toggle
                                tabIndex={-1}
                                {...pauseOnMinimizeToggle}
                            />
                        </Option>
                }
                {
                    shell.active &&
                        <Option label={'SETTINGS_ASS_SUBTITLES_STYLING'}>
                            <Toggle
                                tabIndex={-1}
                                {...assSubtitlesStylingToggle}
                            />
                        </Option>
                }
            </Category>
        </Section>
    );
});

export default Player;
