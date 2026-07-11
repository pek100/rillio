// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useCore } = require('rillio/core');
const { useToast, useFileDrop } = require('rillio/common');
const { getTauri } = require('rillio/common/Platform/shell/isShell');

const ServicesToaster = () => {
    const core = useCore();
    const toast = useToast();
    const filedrop = useFileDrop();

    React.useEffect(() => {
        const onCoreEvent = (name, data) => {
            switch (name) {
                case 'TorrentParsed': {
                    toast.show({
                        type: 'success',
                        title: 'Torrent file parsed',
                        timeout: 4000
                    });
                    break;
                }
                case 'MagnetParsed': {
                    toast.show({
                        type: 'info',
                        title: 'Magnet link parsed',
                        timeout: 4000
                    });
                    break;
                }
                case 'PlayingOnDevice': {
                    toast.show({
                        type: 'success',
                        title: `Stream opened in ${data.device}`,
                        timeout: 4000
                    });
                    break;
                }
            }
        };
        const onCoreError = (source, error) => {
            if (source.event === 'UserPulledFromAPI' && source.args.uid === null) return;
            if (source.event === 'LibrarySyncWithAPIPlanned' && source.args.uid === null) return;
            if (error.type === 'Other' && error.code === 3 && source.event === 'AddonInstalled' && source.args.transport_url.startsWith('https://www.strem.io/trakt/addon')) return;

            toast.show({
                type: 'error',
                title: source.event,
                message: error.message,
                timeout: 4000,
                dataset: {
                    type: 'CoreEvent'
                }
            });
        };
        const onFileDrop = (file, buffer, supported) => {
            if (!supported) {
                toast.show({
                    type: 'error',
                    title: 'Unsupported file',
                    message: file.name,
                    timeout: 4000
                });
            }
        };
        core.on('event', onCoreEvent);
        core.on('error', onCoreError);
        filedrop.on('*', onFileDrop);
        return () => {
            core.off('event', onCoreEvent);
            core.off('error', onCoreError);
            filedrop.off('*', onFileDrop);
        };
    }, []);

    // Desktop self-updater: the native shell checks GitHub Releases on every
    // launch and emits `update-available` with the version. Surface it as a
    // clickable toast (click installs + restarts). Reappears each startup until
    // the update is taken. No-op outside the Tauri shell.
    React.useEffect(() => {
        const TAURI = getTauri();
        if (!TAURI?.event?.listen || !TAURI?.core?.invoke) return;
        let unlisten;
        let cancelled = false;
        TAURI.event.listen('update-available', (event) => {
            const version = typeof event?.payload === 'string' ? event.payload : null;
            toast.show({
                type: 'info',
                icon: 'download',
                title: version ? `Rillio ${version} is available` : 'An update is available',
                message: 'Click to install and restart',
                timeout: 60000,
                onSelect: () => {
                    // Show the full-screen updating overlay (App/UpdatingOverlay)
                    // for the duration; install_update ends by restarting the app.
                    window.dispatchEvent(new CustomEvent('rillio:update-start'));
                    TAURI.core.invoke('install_update').catch((e) => {
                        window.dispatchEvent(new CustomEvent('rillio:update-error'));
                        toast.show({ type: 'error', title: 'Update failed', message: String(e), timeout: 5000 });
                    });
                },
            });
        }).then((un) => { if (cancelled) un(); else unlisten = un; }).catch(() => { /* not in shell */ });
        return () => { cancelled = true; if (typeof unlisten === 'function') unlisten(); };
    }, []);

    // The native shell emits `streaming-server-error` if the in-process streaming
    // server fails to start (e.g. port 11470 already held by another instance).
    // Surface it so a dead backend is not silent. No-op outside the Tauri shell.
    React.useEffect(() => {
        const TAURI = getTauri();
        if (!TAURI?.event?.listen) return;
        let unlisten;
        let cancelled = false;
        TAURI.event.listen('streaming-server-error', (event) => {
            const detail = typeof event?.payload === 'string' ? event.payload : null;
            toast.show({
                type: 'error',
                title: 'Streaming server failed to start',
                message: detail || 'Streams may not load. Another instance may already be using the port.',
                timeout: 10000,
            });
        }).then((un) => { if (cancelled) un(); else unlisten = un; }).catch(() => { /* not in shell */ });
        return () => { cancelled = true; if (typeof unlisten === 'function') unlisten(); };
    }, []);

    return null;
};

module.exports = ServicesToaster;
