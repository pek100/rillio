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
import { uploadToStremio, type UploadAuth, type UploadResult } from 'rillio/common/stremioUpload';
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

type Tab = 'backup' | 'stremio';
// Which way the Stremio tab moves data. Import and Upload used to be two tabs
// carrying two copies of the same sign-in form; they need the SAME credentials,
// so the sign-in is shared now and this only picks what it does afterwards.
type Direction = 'import' | 'upload';

const SyncModal = () => {
    const core = useCore();
    const toast = useToast();
    const [startFacebookLogin] = useFacebookLogin();
    const [startAppleLogin] = useAppleLogin();

    const [open, setOpen] = React.useState(false);
    const [tab, setTab] = React.useState<Tab>('backup');
    const [direction, setDirection] = React.useState<Direction>('import');

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
            setTab(requested === 'stremio' ? 'stremio' : 'backup');
            setDirection('import');
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
            .then(({ itemsPushed, addonsAdded, removalsPushed }: UploadResult) => {
                setUploadStage(null);
                // Count what will actually be VISIBLE on the account. Most of a typical
                // library is `removed: true` - things taken out, plus the "temp"
                // continue-watching entries never explicitly added. Those sync as
                // tombstones and then appear nowhere, so reporting them as "library
                // items sent" reads as a lie: the account looks unchanged. Say the
                // visible number, and mention the removals as what they are.
                const added = itemsPushed - removalsPushed;
                const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
                const parts: string[] = [];
                if (added > 0) parts.push(plural(added, 'library item'));
                if (addonsAdded > 0) parts.push(plural(addonsAdded, 'add-on'));
                const message = parts.length === 0 ?
                    (removalsPushed > 0 ?
                        `Your account was already up to date; synced ${plural(removalsPushed, 'removal')}.` :
                        'Your Stremio account already has everything on this device.') :
                    `Sent ${parts.join(' and ')} to your account.` +
                        (removalsPushed > 0 ? ` (${plural(removalsPushed, 'removal')} also synced.)` : '');
                toast.show({ type: 'success', title: 'Uploaded to Stremio', message, timeout: 6000 });
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

    // Either flow being in flight locks the whole shared form.
    const inFlight = busy || uploadStage !== null;

    const submitWithEmail = direction === 'import' ? importWithEmail : uploadWithEmail;

    if (!open) return null;

    const pillBtn = (selected: boolean, label: string, onClick: () => void) => (
        <Button
            variant="ghost"
            className={cn('h-8 rounded-full px-3.5 text-sm font-medium', selected ? 'bg-accent text-bg hover:bg-accent' : 'text-fg-muted hover:text-fg')}
            onClick={onClick}
        >
            {label}
        </Button>
    );

    const tabBtn = (id: Tab, label: string) => pillBtn(tab === id, label, () => { setError(null); setTab(id); });

    // Switching direction mid-flight would leave the in-flight flow's label on the
    // other direction's button, so it is locked while either is running.
    const directionBtn = (id: Direction, label: string) => pillBtn(
        direction === id,
        label,
        () => { if (!inFlight) { setError(null); setDirection(id); } },
    );

    return (
        <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
            {/* No bg / radius overrides: DialogContent already paints the house panel
                (panel-tint + bg-card + border-line + rounded-squircle + shadow). This
                used to pass `bg-surface rounded-[22px]`, and since cn() is twMerge those
                REPLACED the panel with the 5%-white lift meant for cards on the page -
                translucent over the scrim, so the blurred backdrop showed straight
                through the panel and its buttons. rounded-[22px] was --radius-squircle
                spelled out by hand. Only p-0 stays: the header and bodies own theirs.

                The BODY scrolls, not the panel - same shape as the Cached modal. A
                sticky header inside a scrolling panel needs an opaque fill of its own to
                hide rows passing under it, and that fill paints over --panel-gradient
                exactly where the gradient is strongest (it spans 24rem from the panel's
                top), leaving a flat black band across the head of the modal. Taking the
                header out of the scroller means it needs no fill at all, so the panel's
                own gradient runs behind it, unbroken. */}
            <DialogContent
                showClose={false}
                className="flex max-h-[85dvh] w-full max-w-md flex-col gap-0 overflow-hidden p-0"
            >
                <DialogTitle className="sr-only">Sync</DialogTitle>

                <div className="flex flex-none items-center justify-between gap-2 px-5 pt-4 pb-3">
                    <div className="inline-flex gap-1 rounded-full bg-surface-hover p-1">
                        {tabBtn('backup', 'Backup & restore')}
                        {tabBtn('stremio', 'Stremio')}
                    </div>
                    <IconButton size="sm" title="Close" onClick={close}>
                        <X className="size-4" />
                    </IconButton>
                </div>

                {error ? <div className="mx-5 mb-2 flex-none rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
                            <div className="flex flex-col px-5 pb-6 pt-1">
                                {/* One sign-in, two directions. Both flows need the same
                                Stremio credentials, so the form (and the Facebook /
                                Apple buttons, which have to know which way to go before
                                they open their popup) is shared and this picks what the
                                sign-in does. */}
                                <div className={LABEL}>Stremio</div>
                                <div className={HINT}>Move your library and add-ons between this device and a Stremio account. Sign in once; we never stay connected.</div>

                                <div className="mb-4 inline-flex gap-1 self-start rounded-full bg-surface-hover p-1">
                                    {directionBtn('import', 'Import')}
                                    {directionBtn('upload', 'Upload')}
                                </div>

                                <div className={cn(HINT, 'mt-0')}>
                                    {
                                        direction === 'import' ?
                                            'Pulls your Stremio library and add-ons into Rillio and stores them locally. Your Stremio session is untouched.'
                                            :
                                            'Pushes this device’s library and add-ons to your Stremio account, then signs out. Nothing on the account is removed, newer account data is kept, and your local data stays untouched.'
                                    }
                                </div>

                                <Input className="mb-2.5" type="email" placeholder="Stremio email" value={email} autoComplete="off" disabled={inFlight} onChange={(e) => setEmail(e.target.value)} />
                                <Input className="mb-3" type="password" placeholder="Stremio password" value={password} disabled={inFlight} onChange={(e) => setPassword(e.target.value)} onSubmit={submitWithEmail} />
                                <Button className={cn('w-full', inFlight && 'pointer-events-none opacity-70')} onClick={submitWithEmail}>
                                    {
                                        direction === 'import' ?
                                            (busy ? 'Importing…' : 'Import my data')
                                            :
                                            (uploadStage !== null ? uploadStage : 'Upload my data')
                                    }
                                </Button>

                                <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                                </div>

                                <div className="flex flex-col gap-2.5">
                                    <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', inFlight && 'pointer-events-none opacity-50')} onClick={direction === 'import' ? importWithFacebook : uploadWithFacebook}>
                                        <Facebook className="size-4" />
                                        Continue with Facebook
                                    </Button>
                                    <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', inFlight && 'pointer-events-none opacity-50')} onClick={direction === 'import' ? importWithApple : uploadWithApple}>
                                        <Apple className="size-4" />
                                        Continue with Apple
                                    </Button>
                                </div>
                            </div>
                    }
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default SyncModal;
