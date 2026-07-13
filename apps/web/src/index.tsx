// Copyright (C) 2017-2023 Smart code 203358507

import './styles/tailwind.css';
import Bowser from 'bowser';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import stremioTranslations from 'rillio-translations';
import App from './App';
import { CoreProvider } from './core';
import { FileDropProvider, PlatformProvider } from './common';
// NEVER run the cache-first service worker inside the desktop shell. The shell's
// assets are embedded and swapped in whole by the native updater, and the asset
// path is prefixed with the (stable-between-rebuilds) commit hash, so a
// cache-first SW keeps serving the OLD bundle after every update, and the new UI
// never appears. Detect the shell via the shared predicate.
import { isShell } from './common/Platform/shell/isShell';

const browser = Bowser.parse(window.navigator?.userAgent || '');
if (browser?.platform?.type === 'desktop') {
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', '');
}

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

const root = ReactDOM.createRoot(document.getElementById('app')!);
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

const rawServiceWorkerDisabled = process.env.SERVICE_WORKER_DISABLED as unknown;
const SERVICE_WORKER_DISABLED = rawServiceWorkerDisabled === 'true' || rawServiceWorkerDisabled === true;

const inShell = isShell();

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
