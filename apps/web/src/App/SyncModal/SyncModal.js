// Local-account Sync modal, opened from the account menu via a window event
// (OPEN_SYNC_EVENT). Two jobs, no server of our own:
//   Backup & restore - export the whole local account as one compact code (+ a QR
//     when it fits) and restore from a pasted code.
//   Import from Stremio - a one-time sign-in (email, Facebook, or Apple, the same
//     options Stremio offers) that pulls the Stremio library + add-ons into the
//     local store, then drops the connection (kept anonymous, local).
const React = require('react');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useCore } = require('rillio/core');
const { Button } = require('rillio/components');
const { cn } = require('rillio/common/cn');
const useToast = require('rillio/common/Toast/useToast');
const { setDisplayName } = require('rillio/common/useDisplayName');
const { OPEN_SYNC_EVENT } = require('rillio/common/syncEvents');
const { exportLocalData, importLocalData, anonymizeBucket } = require('rillio/common/localData');
const { makeQrSvg } = require('rillio/common/qr');
const useFacebookLogin = require('rillio/routes/Intro/useFacebookLogin');
const { default: useAppleLogin } = require('rillio/routes/Intro/useAppleLogin');

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
const FIELD = 'w-full h-11 rounded-xl border border-line bg-black/20 px-3.5 text-sm text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-[3px] focus:ring-accent/25 disabled:opacity-50';
const PRIMARY = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-medium text-bg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50';
const GHOST = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/5 text-sm font-medium text-fg transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50';

const SyncModal = () => {
    const core = useCore();
    const toast = useToast();
    const [startFacebookLogin] = useFacebookLogin();
    const [startAppleLogin] = useAppleLogin();

    const [open, setOpen] = React.useState(false);
    const [tab, setTab] = React.useState('backup');

    const [code, setCode] = React.useState('');
    const [exportError, setExportError] = React.useState(null);
    const [restoreDraft, setRestoreDraft] = React.useState('');
    const [copied, setCopied] = React.useState(false);

    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const detachRef = React.useRef(null);

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
        const onOpen = (event) => {
            const requested = event && event.detail ? event.detail.tab : null;
            setTab(requested === 'stremio' ? 'stremio' : 'backup');
            setError(null);
            setRestoreDraft('');
            try {
                setCode(exportLocalData());
                setExportError(null);
            } catch (e) {
                setCode('');
                setExportError((e && e.message) || 'Could not read the local account data.');
            }
            setOpen(true);
        };
        window.addEventListener(OPEN_SYNC_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_SYNC_EVENT, onOpen);
    }, []);

    React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

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
        if (!result.ok) { setError(result.error); return; }
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
        let timeoutId = null;
        const detach = () => {
            core.off('event', onEvent);
            core.off('error', onError);
            if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
            detachRef.current = null;
        };
        const fail = (message) => {
            detach();
            setBusy(false);
            setError(message);
            // The modal may have been closed mid-login; make the failure visible.
            if (!openRef.current) {
                toast.show({ type: 'error', title: 'Stremio import failed', message, timeout: 6000 });
            }
        };
        const onEvent = (name) => {
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
        const onError = (source, error) => {
            const event = source && source.event;
            const message = error && error.message;
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
            .then(({ email: fbEmail, password: fbPassword }) => {
                core.transport.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email: fbEmail, password: fbPassword, facebook: true } } });
            })
            .catch((e) => {
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

    if (!open) return null;

    const tabBtn = (id, label) => (
        <Button
            className={cn('rounded-full px-3.5 py-1.5 text-sm font-medium transition', tab === id ? 'bg-accent text-bg' : 'text-fg-muted hover:text-fg')}
            onClick={() => { setError(null); setTab(id); }}
        >
            {label}
        </Button>
    );

    return (
        <div className="fixed inset-0 z-[2147483200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onClick={close}>
            <div
                className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto rounded-[22px] border border-line bg-surface shadow-elevated"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface px-5 pt-4 pb-3">
                    <div className="inline-flex gap-1 rounded-full bg-white/5 p-1">
                        {tabBtn('backup', 'Backup & restore')}
                        {tabBtn('stremio', 'Import from Stremio')}
                    </div>
                    <Button className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-white/10 hover:text-fg" title="Close" onClick={close}>
                        <Icon className="size-4" name="close" />
                    </Button>
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
                            <input className={cn(FIELD, 'mb-2.5 font-mono text-xs text-fg-muted')} readOnly value={code} onFocus={(e) => e.target.select()} />
                            <Button className={PRIMARY} onClick={copyCode}>
                                <Icon className="size-4" name={copied ? 'checkmark' : 'link'} />
                                {copied ? 'Copied' : 'Copy code'}
                            </Button>

                            <div className="my-5 h-px bg-line" />

                            <div className={LABEL}>Restore from a code</div>
                            <div className={HINT}>Paste a code from another device. This replaces the data on this device.</div>
                            <input className={cn(FIELD, 'mb-3 font-mono text-xs')} placeholder="Paste your sync code here" value={restoreDraft} onChange={(e) => setRestoreDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') restore(); }} />
                            <Button className={GHOST} onClick={restore}>Restore</Button>
                        </div>
                        :
                        <div className="flex flex-col px-5 pb-6 pt-1">
                            <div className={LABEL}>Import from Stremio</div>
                            <div className={HINT}>Sign in once. We pull your library and add-ons into Rillio, store them locally, and don&apos;t stay connected, your Stremio session is untouched.</div>
                            <input className={cn(FIELD, 'mb-2.5')} type="email" placeholder="Stremio email" value={email} autoComplete="off" disabled={busy} onChange={(e) => setEmail(e.target.value)} />
                            <input className={cn(FIELD, 'mb-3')} type="password" placeholder="Stremio password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importWithEmail(); }} />
                            <Button className={cn(PRIMARY, busy && 'pointer-events-none opacity-70')} onClick={importWithEmail}>
                                {busy ? 'Importing…' : 'Import my data'}
                            </Button>

                            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <Button className={cn(GHOST, busy && 'pointer-events-none opacity-50')} onClick={importWithFacebook}>
                                    <Icon className="size-4" name="facebook" />
                                    Continue with Facebook
                                </Button>
                                <Button className={cn(GHOST, busy && 'pointer-events-none opacity-50')} onClick={importWithApple}>
                                    <svg className="size-4" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
                                        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                                    </svg>
                                    Continue with Apple
                                </Button>
                            </div>
                        </div>
                }
            </div>
        </div>
    );
};

module.exports = SyncModal;
