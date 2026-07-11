// Copyright (C) 2017-2023 Smart code 203358507

require('./styles/tailwind.css');

if (typeof process.env.SENTRY_DSN === 'string') {
    const Sentry = require('@sentry/browser');
    Sentry.init({ dsn: process.env.SENTRY_DSN });
}

const Bowser = require('bowser');
const browser = Bowser.parse(window.navigator?.userAgent || '');
if (browser?.platform?.type === 'desktop') {
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', '');
}

const React = require('react');
const ReactDOM = require('react-dom/client');
const { HashRouter } = require('react-router-dom');
const i18n = require('i18next');
const { initReactI18next } = require('react-i18next');
const stremioTranslations = require('rillio-translations');
const App = require('./App');
const { CoreProvider } = require('./core');
const { FileDropProvider, PlatformProvider } = require('./common');

const translations = Object.fromEntries(Object.entries(stremioTranslations()).map(([key, value]) => [key, {
    translation: value
}]));

i18n
    .use(initReactI18next)
    .init({
        resources: translations,
        lng: 'en-US',
        fallbackLng: 'en-US',
        interpolation: {
            escapeValue: false
        }
    });

const appInfo = {
    appVersion: process.env.VERSION,
    shellVersion: null
};

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(
    <React.StrictMode>
        <PlatformProvider>
            <CoreProvider appInfo={appInfo}>
                <FileDropProvider>
                    <HashRouter>
                        <App />
                    </HashRouter>
                </FileDropProvider>
            </CoreProvider>
        </PlatformProvider>
    </React.StrictMode>
);

const SERVICE_WORKER_DISABLED = process.env.SERVICE_WORKER_DISABLED === 'true' || process.env.SERVICE_WORKER_DISABLED === true;

// NEVER run the cache-first service worker inside the desktop shell. The shell's
// assets are embedded and swapped in whole by the native updater, and the asset
// path is prefixed with the (stable-between-rebuilds) commit hash — so a
// cache-first SW keeps serving the OLD bundle after every update, and the new UI
// never appears. Detect the shell on the always-present Tauri global.
const inShell = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

if (process.env.NODE_ENV === 'production' && !SERVICE_WORKER_DISABLED && !inShell && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .catch((registrationError) => {
                console.error('SW registration failed: ', registrationError);
            });
    });
} else if ('serviceWorker' in navigator) {
    // Self-heal when the service worker is not used (the desktop shell, or a
    // build with it disabled): tear down any worker + precache a previous build
    // registered, so it stops serving a stale bundle. Then hard-reload once if a
    // worker was actually controlling this page (it had been serving stale).
    const controlled = !!navigator.serviceWorker.controller;
    Promise.all([
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
            .catch(() => { /* noop */ }),
        (typeof caches !== 'undefined' && caches.keys)
            ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => { /* noop */ })
            : Promise.resolve(),
    ]).then(() => {
        // Only reload if a worker had been intercepting (otherwise this page is
        // already fresh) and we have not reloaded for this reason before.
        if (controlled && !sessionStorage.getItem('rillio-sw-healed')) {
            sessionStorage.setItem('rillio-sw-healed', '1');
            window.location.reload();
        }
    });
}
