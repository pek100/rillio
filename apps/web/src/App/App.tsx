// Copyright (C) 2017-2023 Smart code 203358507

import 'spatial-navigation-polyfill';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCore } from 'rillio/core';
import { Routes } from 'rillio-router';
import { Chromecast, ServicesProvider, GamepadProvider } from 'rillio/services';
import { FullscreenProvider, ToastProvider, ShortcutsProvider, DiscordProvider, CONSTANTS, useBinaryState, useProfile, withCoreSuspender, onFileDrop, usePlatform } from 'rillio/common';
// Foundation-kit Radix Tooltip provider (delay/behaviour context for the kit's
// Tooltip) mounted once at app root. ToastProvider (from rillio/common)
// now resolves to the Sonner-backed adapter that renders the single <Toaster/>.
import { TooltipProvider as KitTooltipProvider } from 'rillio/components/ui/tooltip';
import ServicesToaster from './ServicesToaster';
import NotificationsToaster from './NotificationsToaster';
import SearchParamsHandler from './SearchParamsHandler';
import DeepLinkHandler from './DeepLinkHandler';
import DeepLinkOpenHandler from './DeepLinkOpenHandler';
import UpdaterBanner from './UpdaterBanner';
import ShortcutsModal from './ShortcutsModal';
import GamepadModal from './GamepadModal';
import WindowControls from 'rillio/components/WindowControls/WindowControls';
import ErrorBoundary from 'rillio/components/ErrorBoundary/ErrorBoundary';
import UpdatingOverlay from './UpdatingOverlay/UpdatingOverlay';
import SyncModal from './SyncModal/SyncModal';
import { ensureDisplayName } from 'rillio/common/useDisplayName';
import { SEARCH_MODAL_PATH } from 'rillio/components/SearchModal';

// The Google Cast SDK injects a global `chrome.cast` object at runtime; no
// @types package is installed for it, so it is typed as `any` here.
declare const chrome: any;

const ProtectedRoutes = withCoreSuspender(Routes);
const NAVIGATE_TABS_ROUTES = ['/', '/discover', '/library', '/calendar', '/addons', '/settings'];

const App = () => {
    const core = useCore();
    const profile = useProfile();
    const { i18n } = useTranslation();
    const { shell } = usePlatform();
    const navigate = useNavigate();
    const [gamepadSupportEnabled, setGamepadSupportEnabled] = React.useState(false);
    const services = React.useMemo(() => {
        return {
            chromecast: new Chromecast(),
        };
    }, []);
    const [shortcutModalOpen,, closeShortcutsModal, toggleShortcutModal] = useBinaryState(false);
    const [gamepadModalOpen,, closeGamepadModal, toggleGamepadModal] = useBinaryState(false);

    const onShortcut = React.useCallback((name: string, combo: number, key: string) => {
        switch (name) {
            case 'shortcuts':
                toggleShortcutModal();
                break;
            case 'gamepadGuide':
                toggleGamepadModal();
                break;
            case 'navigateSearch':
                // Search is a URL-driven modal route now (no search landing page).
                navigate(SEARCH_MODAL_PATH);
                break;
            case 'navigateTabs': {
                const index = Number(key) - 1;
                if (index >= 0 && index < NAVIGATE_TABS_ROUTES.length)
                    navigate(NAVIGATE_TABS_ROUTES[index]);
                break;
            }
            case 'navigateHistory':
                navigate(combo === 0 ? -1 : 1);
                break;
        }
    }, [toggleShortcutModal, toggleGamepadModal]);

    // Dismiss the pre-bundle loading screen (index.html) now that the app has
    // mounted and the core is ready. Fade, then remove.
    React.useEffect(() => {
        // Anonymous accounts get a local identity out of the box.
        ensureDisplayName();
        const el = document.getElementById('rillio-loading');
        if (!el) return;
        el.classList.add('rl-hide');
        const timer = setTimeout(() => el.remove(), 500);
        return () => clearTimeout(timer);
    }, []);

    onFileDrop(['application/x-bittorrent'], (file: File, buffer: ArrayBuffer) => {
        core.transport.dispatch({
            action: 'StreamingServer',
            args: {
                action: 'CreateTorrent',
                args: Array.from(new Uint8Array(buffer))
            }
        });
    });

    React.useEffect(() => {
        const onChromecastStateChange = () => {
            if (services.chromecast.active) {
                services.chromecast.transport!.setOptions({
                    receiverApplicationId: CONSTANTS.CHROMECAST_RECEIVER_APP_ID,
                    autoJoinPolicy: chrome.cast.AutoJoinPolicy.PAGE_SCOPED,
                    resumeSavedSession: false,
                    language: null,
                    androidReceiverCompatible: true
                });
            }
        };
        services.chromecast.on('stateChanged', onChromecastStateChange);
        services.chromecast.start();

        (window as any).services = services;
        return () => {
            services.chromecast.stop();
            services.chromecast.off('stateChanged', onChromecastStateChange);
        };
    }, []);

    React.useEffect(() => {
        const onOpenMedia = (data: string) => {
            try {
                const { protocol, hostname, pathname, searchParams } = new URL(data);
                if (protocol === CONSTANTS.PROTOCOL) {
                    if (hostname.length) {
                        const transportUrl = `https://${hostname}${pathname}`;
                        navigate(`/addons?addon=${encodeURIComponent(transportUrl)}`);
                    } else {
                        navigate(`${pathname}?${searchParams.toString()}`);
                    }
                }
            } catch (e) {
                console.error('Failed to open media:', e);
            }
        };

        shell.on('open-media', onOpenMedia);
        if (shell.state.initialized) {
            shell.send('app-ready');
        }

        return () => shell.off('open-media', onOpenMedia);
    }, [shell.state.initialized]);

    React.useEffect(() => {
        if (typeof profile.settings?.interfaceLanguage === 'string') {
            i18n.changeLanguage(profile.settings.interfaceLanguage);
        }

        if (typeof profile.settings?.gamepadSupport === 'boolean') {
            setGamepadSupportEnabled(profile.settings.gamepadSupport);
        }

        if (profile.settings?.quitOnClose && shell.state.windowClosed) {
            shell.send('quit');
        }
    }, [profile.settings, shell.state.windowClosed]);

    React.useEffect(() => {
        const onWindowFocus = () => {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullAddonsFromAPI'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullUserFromAPI',
                    args: {}
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'SyncLibraryWithAPI'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullNotifications'
                }
            });
        };

        onWindowFocus();
        window.addEventListener('focus', onWindowFocus);

        return () => {
            window.removeEventListener('focus', onWindowFocus);
        };
    }, []);

    return (
        <ServicesProvider services={services}>
            <KitTooltipProvider delayDuration={300}>
              <ToastProvider>
                    <GamepadProvider enabled={gamepadSupportEnabled} onGuide={toggleGamepadModal}>
                        <ShortcutsProvider onShortcut={onShortcut}>
                            <FullscreenProvider>
                                <DiscordProvider>
                                    <WindowControls />
                                    <UpdatingOverlay />
                                    {/* Modal layer and routes get their own boundaries, so a crash
                                        in either one cannot white-screen the whole shell. */}
                                    <ErrorBoundary>
                                        <SyncModal />
                                        {
                                            shortcutModalOpen && <ShortcutsModal onClose={closeShortcutsModal}/>
                                        }
                                        {
                                            gamepadModalOpen && <GamepadModal onClose={closeGamepadModal}/>
                                        }
                                    </ErrorBoundary>
                                    <ServicesToaster />
                                    <NotificationsToaster />
                                    <SearchParamsHandler />
                                    <DeepLinkHandler />
                                    <DeepLinkOpenHandler />
                                    <UpdaterBanner className="absolute inset-x-0 bottom-0 z-[1]" />
                                    <ErrorBoundary>
                                        <ProtectedRoutes />
                                    </ErrorBoundary>
                                </DiscordProvider>
                            </FullscreenProvider>
                        </ShortcutsProvider>
                    </GamepadProvider>
              </ToastProvider>
            </KitTooltipProvider>
        </ServicesProvider>
    );
};

export default withCoreSuspender(App);
