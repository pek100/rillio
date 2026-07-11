import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from 'rillio/common';

// Rillio-specific "faster downloads" toggle: it drives the streaming server's
// inbound listen port + UPnP via GET/POST /torrent-settings. That endpoint only
// exists on our embedded Rust server, so a failed fetch (external server, or a
// browser with no server) simply hides the control. The engine reads the
// preference at startup, so a change takes effect on the next app launch.

const normalizeBase = (url?: string | null): string | null =>
    typeof url === 'string' && url.length > 0 ? url.replace(/\/+$/, '') : null;

const useFasterDownloads = (streamingServerUrl?: string | null) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [available, setAvailable] = useState(false);
    const [enabled, setEnabled] = useState(false);

    const base = normalizeBase(streamingServerUrl);

    useEffect(() => {
        let cancelled = false;
        if (!base) {
            setAvailable(false);
            return;
        }
        fetch(`${base}/torrent-settings`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((body) => {
                if (cancelled) return;
                setEnabled(!!body.listenEnabled);
                setAvailable(true);
            })
            .catch(() => {
                if (!cancelled) setAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, [base]);

    const toggle = useCallback(() => {
        if (!base) return;
        const next = !enabled;
        setEnabled(next); // optimistic; reverted on failure below
        fetch(`${base}/torrent-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listenEnabled: next }),
        })
            .then((res) => {
                if (!res.ok) throw new Error(String(res.status));
                toast.show({
                    type: 'success',
                    title: next ? t('SETTINGS_FASTER_DOWNLOADS_ON') : t('SETTINGS_FASTER_DOWNLOADS_OFF'),
                    message: t('SETTINGS_FASTER_DOWNLOADS_RESTART'),
                    timeout: 6000,
                });
            })
            .catch(() => {
                setEnabled(!next);
                toast.show({
                    type: 'error',
                    title: t('SETTINGS_FASTER_DOWNLOADS_FAILED'),
                    timeout: 3000,
                });
            });
    }, [base, enabled, t]);

    return { available, enabled, toggle };
};

export default useFasterDownloads;
