// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Local-account Sync modal, opened from the account menu via a window event
 * (OPEN_SYNC_EVENT). Ported onto the kit Dialog / Input / Button; every sync flow is
 * preserved verbatim. Three jobs, no server of our own:
 *   Backup & restore - export the whole local account as one compact code (+ a QR
 *     when it fits) and restore from a pasted code.
 *   Import from Stremio - a one-time sign-in (email, Facebook, or Apple, the same
 *     options Stremio offers) that pulls the Stremio library + add-ons into the
 *     local store, then drops the connection (kept anonymous, local).
 *   Upload to Stremio - the reverse: a one-time sign-in that pushes this device's
 *     library + add-ons to the Stremio account (common/stremioUpload talks to the
 *     Stremio API directly with a temporary session; local data stays untouched).
 *
 * The kit Dialog owns Escape / outside-click / focus-trap; both route through the
 * busy-aware `close` (via onOpenChange) so a Stremio login in flight keeps its
 * listeners attached and can never leave the app silently signed in.
 */

import React from 'react';
import { X, Check, Link } from 'lucide-react';
import { Apple, Facebook } from 'rillio/components/ui/brand-icons';
import { useCore } from 'rillio/core';
import { cn, Dialog, DialogContent, DialogTitle, Button, IconButton, Input } from 'rillio/components/ui';
import useToast from 'rillio/common/Toast/useToast';
import { setDisplayName } from 'rillio/common/useDisplayName';
import { OPEN_SYNC_EVENT } from 'rillio/common/syncEvents';
import { exportLocalData, importLocalData, anonymizeBucket } from 'rillio/common/localData';
import { uploadToStremio, type UploadAuth } from 'rillio/common/stremioUpload';
import { makeQrSvg } from 'rillio/common/qr';
import useFacebookLogin from 'rillio/routes/Intro/useFacebookLogin';
import useAppleLogin from 'rillio/routes/Intro/useAppleLogin';

// Buckets pulled from Stremio that carry an owner id; rewritten to anonymous.
const OWNED_BUCKETS = ['library', 'library_recent', 'notifications', 'calendar', 'streams', 'search_history'];

// UserAuthenticated only means the core pulled the profile + library into memory;
// the writes to storage are async effects that complete with these events
// (crates/core/src/models/ctx/update_profile.rs and update_library.rs). Both
// always fire after a successful login (auth and the library owner change), so
// wait for them instead of guessing with a timer.
const PERSIST_EVENTS = ['ProfilePushedToStorage', 'LibraryItemsPushedToStorage'];
// Generous ceiling for those storage writes; hitting it is an error, not a signal
// to proceed.
const PERSIST_TIMEOUT_MS = 30000;

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-fg-subtle';
const HINT = 'mt-1.5 mb-3 text-sm leading-snug text-fg-muted';

type Tab = 'backup' | 'stremio' | 'upload';

const SyncModal = () => {
    const core = useCore();
    const toast = useToast();
    const [startFacebookLogin] = useFacebookLogin();
    const [startAppleLogin] = useAppleLogin();

    const [open, setOpen] = React.useState(false);
    const [tab, setTab] = React.useState<Tab>('backup');

    const [code, setCode] = React.useState('');
    const [exportError, setExportError] = React.useState<string | null>(null);
    const [restoreDraft, setRestoreDraft] = React.useState('');
    const [copied, setCopied] = React.useState(false);

    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const detachRef = React.useRef<(() => void) | null>(null);

    // Upload to Stremio: `uploadStage` doubles as the in-flight flag and the
    // progress label on the confirm button.
    const [uploadStage, setUploadStage] = React.useState<string | null>(null);
    const uploadStageRef = React.useRef<string | null>(null);
    React.useEffect(() => { uploadStageRef.current = uploadStage; }, [uploadStage]);

    // Mirrors for the auth listeners, which outlive renders (and, mid-login, the
    // modal itself).
    const openRef = React.useRef(false);
    const busyRef = React.useRef(false);
    React.useEffect(() => { openRef.current = open; }, [open]);
    React.useEffect(() => { busyRef.current = busy; }, [busy]);

    const close = React.useCallback(() => {
        // While a Stremio login is in flight, keep its listeners attached: if
        // UserAuthenticated fires after the modal is gone, the same
        // anonymize-and-reload cleanup still runs, so the app can never be left
        // silently signed in to Stremio. `busy` stays on so reopening shows the
        // in-flight state.
        if (!busyRef.current) {
            if (detachRef.current) { detachRef.current(); detachRef.current = null; }
            setBusy(false);
        }
        setOpen(false); setError(null);
    }, []);

    React.useEffect(() => {
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            const requested = detail ? detail.tab : null;
            setTab(requested === 'stremio' || requested === 'upload' ? requested : 'backup');
            setError(null);
            setRestoreDraft('');
            try {
                setCode(exportLocalData());
                setExportError(null);
            } catch (e) {
                setCode('');
                setExportError((e instanceof Error && e.message) || 'Could not read the local account data.');
            }
            setOpen(true);
        };
        window.addEventListener(OPEN_SYNC_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_SYNC_EVENT, onOpen);
    }, []);

    React.useEffect(() => () => { if (detachRef.current) detachRef.current(); }, []);

    const qrSvg = React.useMemo(() => (open && tab === 'backup' ? makeQrSvg(code) : null), [open, tab, code]);

    const copyCode = React.useCallback(() => {
        if (!code) return;
        navigator.clipboard.writeText(code)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
            .catch(() => toast.show({ type: 'error', title: 'Could not copy', timeout: 3000 }));
    }, [code, toast]);

    const restore = React.useCallback(() => {
        const result = importLocalData(restoreDraft);
        if (!result.ok) { setError(result.error ?? null); return; }
        toast.show({ type: 'success', title: 'Account restored', message: 'Reloading…', timeout: 2000 });
        setTimeout(() => window.location.reload(), 400);
    }, [restoreDraft, toast]);

    // After a Stremio sign-in the core has pulled + persisted the library/add-ons.
    // Rewrite the buckets to anonymous, drop auth locally (without the server-side
    // logout, so the real Stremio session stays alive), name the guest from the
    // email, then reload so the core boots anonymous with everything intact.
    const finishStremioImport = React.useCallback(() => {
        OWNED_BUCKETS.forEach(anonymizeBucket);
        let userEmail = null;
        try {
            const raw = window.localStorage.getItem('profile');
            if (raw) {
                const profile = JSON.parse(raw);
                userEmail = profile && profile.auth && profile.auth.user ? profile.auth.user.email : null;
                if (profile && 'auth' in profile) {
                    profile.auth = null;
                    window.localStorage.setItem('profile', JSON.stringify(profile));
                }
            }
        } catch { /* leave profile as-is */ }
        if (userEmail && userEmail.indexOf('@') > 0) setDisplayName(userEmail.split('@')[0]);
        window.location.reload();
    }, []);

    const attachAuth = React.useCallback(() => {
        const pending = new Set(PERSIST_EVENTS);
        let authenticated = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const detach = () => {
            core.off('event', onEvent);
            core.off('error', onError);
            if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
            detachRef.current = null;
        };
        const fail = (message: string) => {
            detach();
            setBusy(false);
            setError(message);
            // The modal may have been closed mid-login; make the failure visible.
            if (!openRef.current) {
                toast.show({ type: 'error', title: 'Stremio import failed', message, timeout: 6000 });
            }
        };
        const onEvent = (name: string) => {
            if (name === 'UserAuthenticated') {
                authenticated = true;
                timeoutId = setTimeout(() => {
                    fail('Signed in, but saving the imported data locally did not finish. Nothing was switched over, please try again.');
                }, PERSIST_TIMEOUT_MS);
                return;
            }
            if (authenticated && pending.has(name)) {
                pending.delete(name);
                if (pending.size === 0) {
                    detach();
                    toast.show({ type: 'success', title: 'Imported from Stremio', message: 'Reloading…', timeout: 2500 });
                    finishStremioImport();
                }
            }
        };
        const onError = (source: CoreEvent, err: CoreEventError) => {
            const event = source && source.event;
            const message = err && err.message;
            if (event === 'UserAuthenticated') {
                fail(message || 'Sign-in failed. Check your details and try again.');
            } else if (authenticated && PERSIST_EVENTS.indexOf(event) !== -1) {
                fail(message ? `Could not save the imported data: ${message}` : 'Could not save the imported data.');
            }
        };
        core.on('event', onEvent);
        core.on('error', onError);
        detachRef.current = detach;
    }, [core, toast, finishStremioImport]);

    const importWithEmail = React.useCallback(() => {
        if (busy) return;
        if (!email || !password) { setError('Enter your Stremio email and password.'); return; }
        setError(null); setBusy(true);
        attachAuth();
        core.transport.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email, password } } });
    }, [busy, email, password, attachAuth, core]);

    const importWithFacebook = React.useCallback(() => {
        if (busy) return;
        setError(null); setBusy(true);
        attachAuth();
        startFacebookLogin()
            .then(({ email: fbEmail, password: fbPassword }: { email: string, password: string }) => {
                core.transport.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email: fbEmail, password: fbPassword, facebook: true } } });
            })
            .catch((e: Error) => {
                if (detachRef.current) { detachRef.current(); detachRef.current = null; }
                setBusy(false);
                if (e && e.message) setError(e.message);
            });
    }, [busy, attachAuth, startFacebookLogin, core]);

    const importWithApple = React.useCallback(() => {
        if (busy) return;
        setError(null); setBusy(true);
        attachAuth();
        startAppleLogin()
            .then(({ token, sub, email: appleEmail, name }) => {
                core.transport.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Apple', token, sub, email: appleEmail, name } } });
            })
            .catch((e) => {
                if (detachRef.current) { detachRef.current(); detachRef.current = null; }
                setBusy(false);
                if (e && e.message) setError(e.message);
            });
    }, [busy, attachAuth, startAppleLogin, core]);

    // Run the whole upload (common/stremioUpload): sign in with a temporary
    // session, push this device's library + add-ons to the account, sign out.
    // Local data is never modified, so no reload is needed. The promise outlives
    // the modal; if it was closed mid-upload, the outcome surfaces as a toast.
    const runUpload = React.useCallback((auth: UploadAuth) => {
        setError(null);
        setUploadStage('Starting…');
        uploadToStremio(auth, (stage: string) => setUploadStage(stage))
            .then(({ itemsPushed, addonsAdded }: { itemsPushed: number, addonsAdded: number }) => {
                setUploadStage(null);
                const message = itemsPushed === 0 && addonsAdded === 0 ?
                    'Your Stremio account already has everything on this device.' :
                    `Sent ${itemsPushed} library item${itemsPushed === 1 ? '' : 's'} and ${addonsAdded} add-on${addonsAdded === 1 ? '' : 's'} to your account.`;
                toast.show({ type: 'success', title: 'Uploaded to Stremio', message, timeout: 5000 });
            })
            .catch((e: Error) => {
                setUploadStage(null);
                const message = (e && e.message) || 'Upload failed. Please try again.';
                setError(message);
                if (!openRef.current) {
                    toast.show({ type: 'error', title: 'Stremio upload failed', message, timeout: 6000 });
                }
            });
    }, [toast]);

    const uploadWithEmail = React.useCallback(() => {
        if (uploadStage !== null) return;
        if (!email || !password) { setError('Enter your Stremio email and password.'); return; }
        runUpload({ type: 'Login', email, password });
    }, [uploadStage, email, password, runUpload]);

    const uploadWithFacebook = React.useCallback(() => {
        if (uploadStage !== null) return;
        setError(null);
        setUploadStage('Waiting for Facebook…');
        startFacebookLogin()
            .then(({ email: fbEmail, password: fbPassword }: { email: string, password: string }) => {
                runUpload({ type: 'Login', email: fbEmail, password: fbPassword, facebook: true });
            })
            .catch((e: Error) => {
                setUploadStage(null);
                if (e && e.message) setError(e.message);
            });
    }, [uploadStage, startFacebookLogin, runUpload]);

    const uploadWithApple = React.useCallback(() => {
        if (uploadStage !== null) return;
        setError(null);
        setUploadStage('Waiting for Apple…');
        startAppleLogin()
            .then(({ token, sub, email: appleEmail, name }) => {
                runUpload({ type: 'Apple', token, sub, email: appleEmail, name });
            })
            .catch((e) => {
                setUploadStage(null);
                if (e && e.message) setError(e.message);
            });
    }, [uploadStage, startAppleLogin, runUpload]);

    if (!open) return null;

    const tabBtn = (id: Tab, label: string) => (
        <Button
            variant="ghost"
            className={cn('h-8 rounded-full px-3.5 text-sm font-medium', tab === id ? 'bg-accent text-bg hover:bg-accent' : 'text-fg-muted hover:text-fg')}
            onClick={() => { setError(null); setTab(id); }}
        >
            {label}
        </Button>
    );

    return (
        <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
            <DialogContent
                showClose={false}
                className="flex max-h-[85dvh] w-full max-w-md flex-col gap-0 overflow-y-auto rounded-[22px] bg-surface p-0"
            >
                <DialogTitle className="sr-only">Sync</DialogTitle>

                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface px-5 pt-4 pb-3">
                    <div className="inline-flex gap-1 rounded-full bg-surface-hover p-1">
                        {tabBtn('backup', 'Backup & restore')}
                        {tabBtn('stremio', 'Import')}
                        {tabBtn('upload', 'Upload')}
                    </div>
                    <IconButton size="sm" title="Close" onClick={close}>
                        <X className="size-4" />
                    </IconButton>
                </div>

                {error ? <div className="mx-5 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}

                {
                    tab === 'backup' ?
                        <div className="flex flex-col px-5 pb-6 pt-1">
                            <div className={LABEL}>Your sync code</div>
                            <div className={HINT}>Copy this to move your library, calendar and add-ons to another device, or keep it as a backup.</div>
                            {
                                qrSvg ?
                                    // The SVG comes from the local qrcode-generator output of the user's own export string, never remote data.
                                    <div className="mx-auto mb-3.5 w-[200px] rounded-xl bg-white p-2.5 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                                    :
                                    exportError ?
                                        <div className="mb-3.5 rounded-lg bg-danger/10 px-3 py-2.5 text-[0.82rem] text-danger">Could not create your sync code: {exportError}</div>
                                        :
                                        <div className="mb-3.5 rounded-lg bg-warning/10 px-3 py-2.5 text-[0.82rem] text-warning">Your library is too large to show as a scannable code - copy the code below instead.</div>
                            }
                            <Input className="mb-2.5 font-mono text-xs text-fg-muted" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
                            <Button className="w-full" onClick={copyCode}>
                                {copied ? <Check className="size-4" /> : <Link className="size-4" />}
                                {copied ? 'Copied' : 'Copy code'}
                            </Button>

                            <div className="my-5 h-px bg-line" />

                            <div className={LABEL}>Restore from a code</div>
                            <div className={HINT}>Paste a code from another device. This replaces the data on this device.</div>
                            <Input className="mb-3 font-mono text-xs" placeholder="Paste your sync code here" value={restoreDraft} onChange={(e) => setRestoreDraft(e.target.value)} onSubmit={restore} />
                            <Button variant="ghost" className="w-full bg-surface-hover text-fg hover:brightness-110" onClick={restore}>Restore</Button>
                        </div>
                        :
                        tab === 'stremio' ?
                        <div className="flex flex-col px-5 pb-6 pt-1">
                            <div className={LABEL}>Import from Stremio</div>
                            <div className={HINT}>Sign in once. We pull your library and add-ons into Rillio, store them locally, and don&apos;t stay connected, your Stremio session is untouched.</div>
                            <Input className="mb-2.5" type="email" placeholder="Stremio email" value={email} autoComplete="off" disabled={busy} onChange={(e) => setEmail(e.target.value)} />
                            <Input className="mb-3" type="password" placeholder="Stremio password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} onSubmit={importWithEmail} />
                            <Button className={cn('w-full', busy && 'pointer-events-none opacity-70')} onClick={importWithEmail}>
                                {busy ? 'Importing…' : 'Import my data'}
                            </Button>

                            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', busy && 'pointer-events-none opacity-50')} onClick={importWithFacebook}>
                                    <Facebook className="size-4" />
                                    Continue with Facebook
                                </Button>
                                <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', busy && 'pointer-events-none opacity-50')} onClick={importWithApple}>
                                    <Apple className="size-4" />
                                    Continue with Apple
                                </Button>
                            </div>
                        </div>
                        :
                        <div className="flex flex-col px-5 pb-6 pt-1">
                            <div className={LABEL}>Upload to Stremio</div>
                            <div className={HINT}>Sign in once. We push this device&apos;s library and add-ons to your Stremio account, then sign out. Nothing on the account is removed, newer account data is kept, and your local data stays untouched.</div>
                            <Input className="mb-2.5" type="email" placeholder="Stremio email" value={email} autoComplete="off" disabled={uploadStage !== null} onChange={(e) => setEmail(e.target.value)} />
                            <Input className="mb-3" type="password" placeholder="Stremio password" value={password} disabled={uploadStage !== null} onChange={(e) => setPassword(e.target.value)} onSubmit={uploadWithEmail} />
                            <Button className={cn('w-full', uploadStage !== null && 'pointer-events-none opacity-70')} onClick={uploadWithEmail}>
                                {uploadStage !== null ? uploadStage : 'Upload my data'}
                            </Button>

                            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', uploadStage !== null && 'pointer-events-none opacity-50')} onClick={uploadWithFacebook}>
                                    <Facebook className="size-4" />
                                    Continue with Facebook
                                </Button>
                                <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', uploadStage !== null && 'pointer-events-none opacity-50')} onClick={uploadWithApple}>
                                    <Apple className="size-4" />
                                    Continue with Apple
                                </Button>
                            </div>
                        </div>
                }
            </DialogContent>
        </Dialog>
    );
};

export default SyncModal;
