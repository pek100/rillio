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
import SyncModal from './SyncModal/SyncModal';
import ModalHost from './ModalHost';
import ModalUrlWatcher from './ModalUrlWatcher';
import { ensureDisplayName } from 'rillio/common/useDisplayName';
import useStremioSync from 'rillio/common/useStremioSync';
import { openModal, type ModalName } from 'rillio/common/modalEvents';

// The Google Cast SDK injects a global `chrome.cast` object at runtime; no
// @types package is installed for it, so it is typed as `any` here.
declare const chrome: any;

const ProtectedRoutes = withCoreSuspender(Routes);

// Number-key tab shortcuts (1..N). The first four are real routes; Addons and
// Settings are now bus-driven modals, so they open the modal instead of navigating.
type NavigateTab = { type: 'route', to: string } | { type: 'modal', name: ModalName };
const NAVIGATE_TABS: NavigateTab[] = [
    { type: 'route', to: '/' },
    { type: 'route', to: '/discover' },
    { type: 'route', to: '/library' },
    { type: 'route', to: '/calendar' },
    { type: 'modal', name: 'addons' },
    { type: 'modal', name: 'settings' },
];

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

    // Stremio autosync: translates core sync events into the activity log and,
    // while connected, schedules the two-way sync (launch / focus / interval).
    useStremioSync();

    const onShortcut = React.useCallback((name: string, combo: number, key: string) => {
        switch (name) {
            case 'shortcuts':
                toggleShortcutModal();
                break;
            case 'gamepadGuide':
                toggleGamepadModal();
                break;
            case 'navigateSearch':
                // Search is a bus-driven modal now (no search landing page).
                openModal('search');
                break;
            case 'navigateTabs': {
                const index = Number(key) - 1;
                if (index >= 0 && index < NAVIGATE_TABS.length) {
                    const tab = NAVIGATE_TABS[index];
                    if (tab.type === 'route') {
                        navigate(tab.to);
                    } else {
                        openModal(tab.name);
                    }
                }
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
                        // Open the Addons modal pre-expanded on this addon (bus, not URL).
                        openModal('addons', { addon: transportUrl });
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

    // Notifications refresh on boot + focus. Account sync (PullAddonsFromAPI /
    // PullUserFromAPI / SyncLibraryWithAPI) used to be dispatched here too,
    // unconditionally - even for anonymous users, whose runs just errored
    // "User is not logged in" (invisible until the sync activity log existed).
    // useStremioSync owns account sync now: gated on a connection, throttled,
    // and every run logged.
    React.useEffect(() => {
        const onWindowFocus = () => {
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
                                    {/* Modal layer and routes get their own boundaries, so a crash
                                        in either one cannot white-screen the whole shell. */}
                                    <ErrorBoundary>
                                        <SyncModal />
                                        <ModalHost />
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
                                    <ModalUrlWatcher />
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
