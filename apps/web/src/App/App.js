// Copyright (C) 2017-2023 Smart code 203358507

require('spatial-navigation-polyfill');
const React = require('react');
const { useTranslation } = require('react-i18next');
const { useNavigate } = require('react-router');
const { useCore } = require('rillio/core');
const { Routes } = require('rillio-router');
const { Chromecast, ServicesProvider, GamepadProvider } = require('rillio/services');
const { FullscreenProvider, ToastProvider, TooltipProvider, ShortcutsProvider, DiscordProvider, CONSTANTS, useBinaryState, useProfile, withCoreSuspender, onFileDrop, usePlatform } = require('rillio/common');
// Foundation-kit Radix Tooltip provider (delay/behaviour context for the kit's
// Tooltip). Mounted alongside the legacy TooltipProvider, which still backs the
// not-yet-migrated legacy <Tooltip> call sites. ToastProvider (from rillio/common)
// now resolves to the Sonner-backed adapter that renders the single <Toaster/>.
const { TooltipProvider: KitTooltipProvider } = require('rillio/components/ui/tooltip');
const ServicesToaster = require('./ServicesToaster');
const NotificationsToaster = require('./NotificationsToaster');
const SearchParamsHandler = require('./SearchParamsHandler');
const DeepLinkHandler = require('./DeepLinkHandler');
const DeepLinkOpenHandler = require('./DeepLinkOpenHandler');
const { default: UpdaterBanner } = require('./UpdaterBanner');
const { default: ShortcutsModal } = require('./ShortcutsModal');
const { default: GamepadModal } = require('./GamepadModal');
const { default: WindowControls } = require('rillio/components/WindowControls/WindowControls');
const { default: ErrorBoundary } = require('rillio/components/ErrorBoundary/ErrorBoundary');
const { default: UpdatingOverlay } = require('./UpdatingOverlay/UpdatingOverlay');
const { default: SyncModal } = require('./SyncModal/SyncModal');
const { ensureDisplayName } = require('rillio/common/useDisplayName');
const { SEARCH_MODAL_PATH } = require('rillio/components/SearchModal');
const styles = require('./styles');

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

    const onShortcut = React.useCallback((name, combo, key) => {
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

    onFileDrop(['application/x-bittorrent'], (file, buffer) => {
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
                services.chromecast.transport.setOptions({
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

        window.services = services;
        return () => {
            services.chromecast.stop();
            services.chromecast.off('stateChanged', onChromecastStateChange);
        };
    }, []);

    React.useEffect(() => {
        const onOpenMedia = (data) => {
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
                <TooltipProvider className={styles['tooltip-container']}>
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
                                    <UpdaterBanner className={styles['updater-banner-container']} />
                                    <ErrorBoundary>
                                        <ProtectedRoutes />
                                    </ErrorBoundary>
                                </DiscordProvider>
                            </FullscreenProvider>
                        </ShortcutsProvider>
                    </GamepadProvider>
                </TooltipProvider>
              </ToastProvider>
            </KitTooltipProvider>
        </ServicesProvider>
    );
};

module.exports = withCoreSuspender(App);
