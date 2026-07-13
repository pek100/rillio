// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Account hub panel (contents of the NavMenu popover). Clean-room rewrite of the
 * legacy styles.less panel onto Tailwind semantic tokens; every hook/dispatch is
 * reused verbatim (Logout, PlayUrl clipboard, sync events, display-name edit,
 * fullscreen, shell gating). Rendered inside the kit Popover, so it no longer owns
 * its own positioning - just the flat, divide-y panel body.
 */

import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { useCore } from 'rillio/core';
import { useFullscreen } from 'rillio/common/Fullscreen';
import { withCoreSuspender } from 'rillio/common/CoreSuspender';
import { useDisplayName } from 'rillio/common/useDisplayName';
import { openSync } from 'rillio/common/syncEvents';
import { useToast } from 'rillio/components/ui/use-toast';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';
import DisplayNameEdit from 'rillio/components/DisplayNameEdit';
import { useIsShell } from 'rillio/components/WindowControls/WindowControls';

const useProfile = require('rillio/common/useProfile');
const usePWA = require('rillio/common/usePWA');
const useStreamingServer = require('rillio/common/useStreamingServer');
const { default: usePlayUrl } = require('rillio/common/usePlayUrl');
const avatarAnonymous = require('/assets/images/avatar-anonymous.svg');
const avatarDefault = require('/assets/images/avatar-default.svg');

const ROW = 'flex h-11 w-full items-center gap-3 rounded-none px-5 text-sm font-normal text-fg transition-colors duration-150 hover:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle hover:[&_svg]:text-fg';

type Props = {
    onSelect?: () => void,
};

const NavMenuContent = ({ onSelect }: Props) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const core = useCore();
    const profile = useProfile();
    const [displayName, setDisplayName] = useDisplayName();
    const streamingServer = useStreamingServer();
    const { handlePlayUrl } = usePlayUrl();
    const toast = useToast();
    const [fullscreen, requestFullscreen, exitFullscreen, , supported] = useFullscreen();
    const [, isAndroidPWA] = usePWA();
    // In the desktop shell the window header owns (native) fullscreen; this
    // browser-API entry would only fullscreen the webview inside the frame.
    const inShell = useIsShell();

    const logout = React.useCallback(() => {
        core.transport.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
    }, [core]);

    const onPlayMagnetLinkClick = React.useCallback(async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            const handled = await handlePlayUrl(clipboardText);
            if (!handled) {
                toast.show({
                    type: 'error',
                    title: 'Clipboard does not contain a valid URL or magnet link.',
                    timeout: 5000
                });
            }
        } catch (e) {
            console.error(e);
        }
    }, [handlePlayUrl, toast]);

    const handleAuth = React.useCallback(() => {
        return profile.auth !== null ? logout() : navigate('/intro');
    }, [profile.auth, logout, navigate]);

    const avatarUrl = profile.auth === null
        ? avatarAnonymous
        : (profile.auth.user.avatar || avatarDefault);

    return (
        <div className="max-h-[calc(100vh-6rem)] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto" onClick={onSelect}>
            <div className="flex items-center gap-4 p-6">
                <div
                    className="size-10 shrink-0 rounded-full bg-cover bg-center bg-no-repeat opacity-90"
                    style={{ backgroundImage: `url('${avatarUrl}')`, backgroundColor: 'var(--color-fg)' }}
                />
                <div className="flex min-w-0 flex-auto flex-col justify-center">
                    <DisplayNameEdit className="min-h-[1.6rem]" value={displayName} onCommit={setDisplayName} />
                    {
                        profile.auth !== null ?
                            <div className="mt-1 flex items-center gap-2">
                                <div className="min-w-0 flex-1 truncate text-[0.85rem] text-fg-subtle" title={profile.auth.user.email}>{profile.auth.user.email}</div>
                                <Button
                                    variant="link"
                                    className="h-auto shrink-0 p-0 text-[0.85rem] font-semibold text-accent no-underline hover:brightness-110 hover:no-underline"
                                    title={t('LOG_OUT')}
                                    onClick={handleAuth}
                                >
                                    {t('LOG_OUT')}
                                </Button>
                            </div>
                            :
                            <div className="mt-1 text-[0.85rem] text-fg-subtle">{t('ANONYMOUS_USER')}</div>
                    }
                </div>
            </div>

            {
                supported && !isAndroidPWA && !inShell ?
                    <div className="border-t border-line py-1">
                        <Button variant="ghost" className={ROW} title={fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')} onClick={fullscreen ? exitFullscreen : requestFullscreen}>
                            <Icon name={fullscreen ? 'minimize' : 'maximize'} />
                            <span className="flex-1 text-left">{fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')}</span>
                        </Button>
                    </div>
                    :
                    null
            }

            <div className="border-t border-line py-1">
                <Button variant="ghost" className={ROW} title={t('SETTINGS')} href="#/settings">
                    <Icon name="settings" />
                    <span className="flex-1 text-left">{t('SETTINGS')}</span>
                </Button>
                <Button variant="ghost" className={ROW} title="Sync & backup" onClick={() => openSync('backup')}>
                    <Icon name="cloud-sync" />
                    <span className="flex-1 text-left">Sync & backup</span>
                </Button>
                <Button variant="ghost" className={ROW} title="Import from Stremio" onClick={() => openSync('stremio')}>
                    <Icon name="download" />
                    <span className="flex-1 text-left">Import from Stremio</span>
                </Button>
                <Button variant="ghost" className={ROW} title="Upload to Stremio" onClick={() => openSync('upload')}>
                    <Icon name="cloud-library" />
                    <span className="flex-1 text-left">Upload to Stremio</span>
                </Button>
                <Button variant="ghost" className={ROW} title={t('PLAY_URL_MAGNET_LINK')} onClick={onPlayMagnetLinkClick}>
                    <Icon name="magnet-link" />
                    <span className="flex-1 text-left">{t('PLAY_URL_MAGNET_LINK')}</span>
                </Button>
                <Button variant="ghost" className={ROW} title={t('HELP_FEEDBACK')} href="https://github.com/pek100/rillio/issues" target="_blank">
                    <Icon name="help" />
                    <span className="flex-1 text-left">{t('HELP_FEEDBACK')}</span>
                </Button>
            </div>

            <div className="border-t border-line py-1">
                <Button variant="ghost" className={ROW} title="Website" href="https://rillio.app" target="_blank">
                    <span className="flex-1 text-left">Website</span>
                </Button>
            </div>
        </div>
    );
};

const NavMenuContentFallback = () => (
    <div className="w-[22rem] max-w-[calc(100vw-1rem)]" />
);

export default withCoreSuspender(NavMenuContent, NavMenuContentFallback);
