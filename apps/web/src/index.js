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

if (process.env.NODE_ENV === 'production' && !SERVICE_WORKER_DISABLED && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .catch((registrationError) => {
                console.error('SW registration failed: ', registrationError);
            });
    });
} else if ('serviceWorker' in navigator) {
    // Self-heal when the service worker is disabled (e.g. the desktop shell,
    // where assets are embedded and always fresh): tear down any previously
    // installed worker + precache. Without this a stale cache-first SW keeps
    // serving an old bundle across rebuilds — the commit-hash asset folder is
    // stable, so the SW never sees a new URL to fetch.
    navigator.serviceWorker.getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()))
        .catch(() => { /* noop */ });
    if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys()
            .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
            .catch(() => { /* noop */ });
    }
}
