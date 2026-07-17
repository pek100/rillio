// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Sync modal, opened from the account menu via a window event (OPEN_SYNC_EVENT).
 * Two tabs, no server of our own:
 *   Backup & restore - export the whole local account as one compact code (+ a
 *     QR when it fits) and restore from a pasted code.
 *   Stremio - a PERSISTENT connection to a Stremio account. Connecting signs in
 *     and the core MERGES the account with the local data (settings kept, local
 *     library/add-ons kept and pushed up - update_profile.rs / update_library.rs
 *     CtxAuthResult); the app then stays connected and autosyncs both ways
 *     (common/useStremioSync). Disconnect (Ctx.Disconnect) closes the session
 *     but keeps everything on the device. The old one-shot Import (sign in,
 *     pull, drop auth) and Upload (temporary session, push, sign out) are gone:
 *     both are subsumed by connect + two-way sync.
 *
 * Trust, verified: a Differences panel diffs the local buckets against the
 * server (common/stremioApi, read-only) so a sync is PROVABLE - before: what
 * will move; after: both sides converged. A Recent-activity list shows what the
 * core actually did (common/syncActivity).
 */

import React from 'react';
import { X, Check, Link, RefreshCw } from 'lucide-react';
import { Apple, Facebook } from 'rillio/components/ui/brand-icons';
import { useCore } from 'rillio/core';
import { cn, Dialog, DialogContent, DialogTitle, Button, IconButton, Input } from 'rillio/components/ui';
import useToast from 'rillio/common/Toast/useToast';
import { OPEN_SYNC_EVENT } from 'rillio/common/syncEvents';
import { exportLocalData, importLocalData } from 'rillio/common/localData';
import { computeSyncDiff, diffIsClean, type SyncDiff } from 'rillio/common/stremioApi';
import { readSyncLog, onSyncActivity, logSync, type SyncLogEntry } from 'rillio/common/syncActivity';
import { makeQrSvg } from 'rillio/common/qr';
import useFacebookLogin from 'rillio/common/useFacebookLogin';
import useAppleLogin from 'rillio/common/useAppleLogin';

const useProfile = require('rillio/common/useProfile');

// UserAuthenticated only means the core pulled + merged the profile + library in
// memory; the writes to storage are async effects that complete with these
// events (update_profile.rs / update_library.rs). Both always fire after a
// successful login, so wait for them instead of guessing with a timer.
const PERSIST_EVENTS = ['ProfilePushedToStorage', 'LibraryItemsPushedToStorage'];
// Generous ceiling for those storage writes; hitting it is an error, not a
// signal to proceed.
const PERSIST_TIMEOUT_MS = 30000;

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-fg-subtle';
const HINT = 'mt-1.5 mb-3 text-sm leading-snug text-fg-muted';

type Tab = 'backup' | 'stremio';

const formatTs = (ts: number): string => {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

// A capped list of diff rows ("name" or the raw id), with an "and N more" tail.
const DiffList = ({ entries, tone }: { entries: { id?: string, transportUrl?: string, name: string | null, removed?: boolean }[], tone: string }) => {
    const MAX_ROWS = 6;
    const shown = entries.slice(0, MAX_ROWS);
    return (
        <div className="mb-2">
            {shown.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5 text-[0.82rem] text-fg-muted">
                    <span className={cn('size-1.5 shrink-0 rounded-full', tone)} />
                    <span className="min-w-0 flex-1 truncate">{entry.name || entry.id || entry.transportUrl}</span>
                    {entry.removed ? <span className="shrink-0 text-[0.72rem] uppercase tracking-wide text-fg-subtle">removal</span> : null}
                </div>
            ))}
            {entries.length > MAX_ROWS ?
                <div className="py-0.5 pl-3.5 text-[0.78rem] text-fg-subtle">and {entries.length - MAX_ROWS} more</div>
                : null}
        </div>
    );
};

const SyncModal = () => {
    const core = useCore();
    const toast = useToast();
    const profile = useProfile();
    const [startFacebookLogin] = useFacebookLogin();
    const [startAppleLogin] = useAppleLogin();

    // Loose null checks: before the first core state lands profile.auth can be
    // undefined, and that must read as "not connected", never as a crash.
    const connected = profile.auth != null;
    const authKey: string | null = (profile.auth as any)?.key ?? null;
    const accountEmail: string | null = (profile.auth as any)?.user?.email ?? null;

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

    const [syncing, setSyncing] = React.useState(false);
    const [diff, setDiff] = React.useState<SyncDiff | null>(null);
    const [diffBusy, setDiffBusy] = React.useState(false);
    const [diffError, setDiffError] = React.useState<string | null>(null);
    const [activity, setActivity] = React.useState<SyncLogEntry[]>([]);

    // Mirrors for the auth listeners, which outlive renders (and, mid-login, the
    // modal itself).
    const openRef = React.useRef(false);
    const busyRef = React.useRef(false);
    React.useEffect(() => { openRef.current = open; }, [open]);
    React.useEffect(() => { busyRef.current = busy; }, [busy]);

    const close = React.useCallback(() => {
        // While a connect is in flight, keep its listeners attached: the
        // post-connect sync dispatches and the outcome toast still run if
        // UserAuthenticated arrives after the modal is gone.
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

    // ---- Differences panel ----------------------------------------------

    const refreshDiff = React.useCallback(() => {
        if (!authKey) return;
        setDiffBusy(true);
        setDiffError(null);
        computeSyncDiff(authKey)
            .then((next) => setDiff(next))
            .catch((e: Error) => setDiffError((e && e.message) || 'Could not compare with the account.'))
            .finally(() => setDiffBusy(false));
    }, [authKey]);

    // Compute on opening the connected Stremio tab, and re-compute shortly
    // after sync activity settles - the "after" half of before/after.
    React.useEffect(() => {
        if (!open || tab !== 'stremio' || !connected) return;
        refreshDiff();
        setActivity(readSyncLog());
        let debounce: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = onSyncActivity(() => {
            setActivity(readSyncLog());
            if (debounce !== null) clearTimeout(debounce);
            debounce = setTimeout(() => { refreshDiff(); setSyncing(false); }, 1500);
        });
        return () => {
            unsubscribe();
            if (debounce !== null) clearTimeout(debounce);
        };
    }, [open, tab, connected, refreshDiff]);

    // ---- Connect (persistent session; the core merges local + account) ----

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
            if (!openRef.current) {
                toast.show({ type: 'error', title: 'Stremio connect failed', message, timeout: 6000 });
            }
        };
        const onEvent = (name: string) => {
            if (name === 'UserAuthenticated') {
                authenticated = true;
                timeoutId = setTimeout(() => {
                    fail('Signed in, but saving the merged data locally did not finish. Please try again.');
                }, PERSIST_TIMEOUT_MS);
                return;
            }
            if (authenticated && pending.has(name)) {
                pending.delete(name);
                if (pending.size === 0) {
                    detach();
                    setBusy(false);
                    setPassword('');
                    // Push the merged-in local add-ons (union from
                    // CtxAuthResult). The library sync is NOT dispatched here:
                    // useStremioSync fires a full guarded run when `connected`
                    // flips true - dispatching it here too double-pushed on
                    // connect ("Sent 20 library items" twice in the log).
                    core.transport.dispatch({ action: 'Ctx', args: { action: 'PushAddonsToAPI' } });
                    toast.show({
                        type: 'success',
                        title: 'Stremio sync connected',
                        message: 'Your data stays on this device and now also syncs via Stremio. Disconnect anytime.',
                        timeout: 6000,
                    });
                }
            }
        };
        const onError = (source: CoreEvent, err: CoreEventError) => {
            const event = source && source.event;
            const message = err && err.message;
            if (event === 'UserAuthenticated') {
                fail(message || 'Sign-in failed. Check your details and try again.');
            } else if (authenticated && PERSIST_EVENTS.indexOf(event) !== -1) {
                fail(message ? `Could not save the merged data: ${message}` : 'Could not save the merged data.');
            }
        };
        core.on('event', onEvent);
        core.on('error', onError);
        detachRef.current = detach;
    }, [core, toast]);

    const connectWithEmail = React.useCallback(() => {
        if (busy) return;
        if (!email || !password) { setError('Enter your Stremio email and password.'); return; }
        setError(null); setBusy(true);
        attachAuth();
        core.transport.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email, password } } });
    }, [busy, email, password, attachAuth, core]);

    const connectWithFacebook = React.useCallback(() => {
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

    const connectWithApple = React.useCallback(() => {
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

    // ---- Connected actions ------------------------------------------------

    const syncNow = React.useCallback(() => {
        if (syncing) return;
        setSyncing(true);
        logSync('manual', 'Sync started (manual)');
        core.transport.dispatch({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
        core.transport.dispatch({ action: 'Ctx', args: { action: 'PullAddonsFromAPI' } });
        core.transport.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        // The activity subscription clears `syncing` and refreshes the diff
        // when the resulting events settle; this is only a stuck-guard.
        setTimeout(() => setSyncing(false), 8000);
    }, [syncing, core]);

    const disconnect = React.useCallback(() => {
        const onEvent = (name: string) => {
            if (name !== 'SessionDisconnected') return;
            core.off('event', onEvent);
            toast.show({
                type: 'success',
                title: 'Disconnected from Stremio',
                message: 'Everything synced stays saved on this device.',
                timeout: 5000,
            });
        };
        core.on('event', onEvent);
        core.transport.dispatch({ action: 'Ctx', args: { action: 'Disconnect' } });
        setDiff(null);
    }, [core, toast]);

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

    const diffSummary = diff === null ? null : diffIsClean(diff) ?
        'Everything is in sync.' :
        [
            diff.toPush.length > 0 ? `${diff.toPush.length} to send` : null,
            diff.toPull.length > 0 ? `${diff.toPull.length} to fetch` : null,
            diff.addonsLocalOnly.length > 0 ? `${diff.addonsLocalOnly.length} add-on${diff.addonsLocalOnly.length === 1 ? '' : 's'} to send` : null,
            diff.addonsServerOnly.length > 0 ? `${diff.addonsServerOnly.length} add-on${diff.addonsServerOnly.length === 1 ? '' : 's'} to fetch` : null,
        ].filter(Boolean).join(', ');

    return (
        <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
            {/* Panel styling notes preserved from the previous revision: DialogContent
                paints the house panel; only p-0 here, the bodies own their padding;
                the BODY scrolls, not the panel, so the header needs no fill. */}
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
                            connected ?
                                <div className="flex flex-col px-5 pb-6 pt-1">
                                    <div className={LABEL}>Stremio sync service</div>
                                    <div className={HINT}>
                                        Syncing via <span className="text-fg">{accountEmail}</span>. Your data always
                                        lives on this device; Stremio keeps your library and add-ons in sync across
                                        your devices, both ways. Disconnect anytime - everything stays saved here.
                                    </div>

                                    <div className="flex gap-2.5">
                                        <Button className={cn('flex-1', syncing && 'pointer-events-none opacity-70')} onClick={syncNow}>
                                            {syncing ? 'Syncing…' : 'Sync now'}
                                        </Button>
                                        <Button variant="ghost" className="flex-1 bg-surface-hover text-fg hover:brightness-110" onClick={disconnect}>
                                            Disconnect
                                        </Button>
                                    </div>

                                    <div className="my-5 h-px bg-line" />

                                    <div className="flex items-center justify-between">
                                        <div className={LABEL}>Differences</div>
                                        <IconButton size="sm" title="Compare with the account again" onClick={refreshDiff}>
                                            <RefreshCw className={cn('size-3.5', diffBusy && 'animate-spin')} />
                                        </IconButton>
                                    </div>
                                    {
                                        diffError ?
                                            <div className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[0.82rem] text-danger">{diffError}</div>
                                            :
                                            diff === null ?
                                                <div className={HINT}>Comparing this device with the account…</div>
                                                :
                                                <>
                                                    <div className={cn(HINT, 'mb-2')}>
                                                        {diffSummary} <span className="text-fg-subtle">({diff.localItems} items here, {diff.serverItems} on the account)</span>
                                                    </div>
                                                    {diff.toPush.length > 0 ? <DiffList entries={diff.toPush} tone="bg-accent" /> : null}
                                                    {diff.toPull.length > 0 ? <DiffList entries={diff.toPull} tone="bg-fg-subtle" /> : null}
                                                    {diff.addonsLocalOnly.length > 0 ? <DiffList entries={diff.addonsLocalOnly} tone="bg-accent" /> : null}
                                                    {diff.addonsServerOnly.length > 0 ? <DiffList entries={diff.addonsServerOnly} tone="bg-fg-subtle" /> : null}
                                                </>
                                    }

                                    <div className="my-5 h-px bg-line" />

                                    <div className={LABEL}>Recent activity</div>
                                    {
                                        activity.length === 0 ?
                                            <div className={HINT}>No sync activity yet.</div>
                                            :
                                            <div className="mt-1.5 max-h-44 divide-y divide-line overflow-y-auto">
                                                {activity.slice(0, 30).map((entry, i) => (
                                                    <div key={i} className="flex items-baseline gap-2.5 py-1.5">
                                                        <span className="shrink-0 font-mono text-[0.72rem] text-fg-subtle">{formatTs(entry.ts)}</span>
                                                        <span className={cn('min-w-0 flex-1 text-[0.82rem] leading-snug', entry.error ? 'text-danger' : 'text-fg-muted')}>{entry.message}</span>
                                                    </div>
                                                ))}
                                            </div>
                                    }
                                </div>
                                :
                                <div className="flex flex-col px-5 pb-6 pt-1">
                                    <div className={LABEL}>Stremio sync service</div>
                                    <div className={HINT}>
                                        Your account is local: everything lives on this device, no servers needed.
                                        Optionally, connect a Stremio account as a sync service - your library and
                                        add-ons then stay in sync across your devices, both ways. Disconnect anytime;
                                        everything synced stays saved here.
                                    </div>

                                    <Input className="mb-2.5" type="email" placeholder="Stremio email" value={email} autoComplete="off" disabled={busy} onChange={(e) => setEmail(e.target.value)} />
                                    <Input className="mb-3" type="password" placeholder="Stremio password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} onSubmit={connectWithEmail} />
                                    <Button className={cn('w-full', busy && 'pointer-events-none opacity-70')} onClick={connectWithEmail}>
                                        {busy ? 'Connecting…' : 'Connect'}
                                    </Button>

                                    <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                                        <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                                    </div>

                                    <div className="flex flex-col gap-2.5">
                                        <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', busy && 'pointer-events-none opacity-50')} onClick={connectWithFacebook}>
                                            <Facebook className="size-4" />
                                            Continue with Facebook
                                        </Button>
                                        <Button variant="ghost" className={cn('w-full bg-surface-hover text-fg hover:brightness-110', busy && 'pointer-events-none opacity-50')} onClick={connectWithApple}>
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
