import React from 'react';
import { getTauri, isShell, useIsShell } from 'rillio/common/Platform/shell/isShell';

// Re-exported for existing consumers (NavBar, TopNav); shell detection lives
// in common/Platform/shell/isShell.ts, the single source of truth.
export { isShell, useIsShell };

const currentWindow = () => getTauri()?.window?.getCurrentWindow?.();

// How close to the top edge the pointer must come to reveal the header while
// fullscreen. Comfortably taller than the 2rem control row itself.
const REVEAL_ZONE_PX = 48;

// The window is frameless (decorations off in the Tauri shell), so the web app
// draws its own controls. They float in the top-right on every route and stay
// clickable (never a drag region); a thin strip along the very top edge, plus
// the draggable nav on the main routes, moves the window.
//
// While FULLSCREEN the whole header (controls + drag strip) hides and only
// returns when the pointer approaches the top edge, so nothing overlays the
// film. Revealing is driven by a pointer position test rather than a hover
// target: an invisible full-width strip would swallow clicks meant for the
// player's own top bar underneath it.
const WindowControls = () => {
    const shell = useIsShell();
    const [maximized, setMaximized] = React.useState(false);
    const [fullscreen, setFullscreen] = React.useState(false);
    const [nearTop, setNearTop] = React.useState(false);

    // Depends on the reactive `shell` so it attaches once useIsShell() flips
    // true, even when the Tauri global appeared after the first render (the
    // exact case the hook exists for).
    React.useEffect(() => {
        if (!shell) return undefined;
        const win = currentWindow();
        if (!win) return undefined;

        let unlisten: (() => void) | undefined;
        let cancelled = false;

        const sync = () => {
            win.isMaximized?.()
                .then((m: boolean) => { if (!cancelled) setMaximized(!!m); })
                .catch(() => { /* getter unavailable, keep last state */ });
            win.isFullscreen?.()
                .then((f: boolean) => { if (!cancelled) setFullscreen(!!f); })
                .catch(() => { /* getter unavailable, keep last state */ });
        };

        sync();
        win.onResized?.(sync)
            .then((un: () => void) => { if (cancelled) un(); else unlisten = un; })
            .catch(() => { /* no resize events, icon just won't flip */ });

        return () => { cancelled = true; if (unlisten) unlisten(); };
    }, [shell]);

    // Any attempt to drag the window (mousedown on any drag region, incl. the
    // navbars') collapses fullscreen first, dragging a fullscreen window is
    // what corrupts the window state. Capture phase so it runs before the
    // native drag begins.
    React.useEffect(() => {
        if (!shell) return undefined;
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !target.hasAttribute || !target.hasAttribute('data-tauri-drag-region')) return;
            const win = currentWindow();
            win?.isFullscreen?.()
                .then((f: boolean) => {
                    if (f) return win.setFullscreen(false).then(() => setFullscreen(false));
                })
                .catch(() => { /* no-op */ });
        };
        window.addEventListener('mousedown', onDown, true);
        return () => window.removeEventListener('mousedown', onDown, true);
    }, [shell]);

    // Fullscreen has no window header to clear, so the gap that keeps chrome off it
    // collapses: this flag drives --nav-top-gap to 0 (see styles/tailwind.css), which
    // both the main navbar and the player's top bar consume.
    React.useEffect(() => {
        if (!shell) return undefined;
        const root = document.documentElement;
        root.classList.toggle('window-fullscreen', fullscreen);
        return () => root.classList.remove('window-fullscreen');
    }, [shell, fullscreen]);

    // Fullscreen only: reveal the header when the pointer nears the top edge.
    // Leaving fullscreen resets the flag so the header is unconditionally shown.
    React.useEffect(() => {
        if (!shell || !fullscreen) {
            setNearTop(false);
            return undefined;
        }
        const onMove = (e: MouseEvent) => setNearTop(e.clientY <= REVEAL_ZONE_PX);
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, [shell, fullscreen]);

    if (!shell) return null;

    const headerHidden = fullscreen && !nearTop;
    // pointer-events off while hidden: an invisible drag strip / control row must
    // not intercept clicks aimed at the player chrome beneath it.
    const headerVisibility = headerHidden ? 'pointer-events-none opacity-0' : 'opacity-100';

    // Fullscreen is fragile: any other window operation (drag, minimize,
    // maximize) performed while fullscreen leaves Windows in a stuck half-state
    // (no resize, no Aero snap). So fullscreen COLLAPSES on any window change:
    // every control exits it first, and grabbing any drag region exits it too.
    const collapseFullscreen = () => {
        const win = currentWindow();
        if (!win?.isFullscreen) return Promise.resolve();
        return win.isFullscreen()
            .then((f: boolean) => {
                if (f) return win.setFullscreen(false).then(() => setFullscreen(false));
            })
            .catch(() => { /* no-op */ });
    };

    const minimize = () => { collapseFullscreen().then(() => currentWindow()?.minimize?.()); };
    const toggleMaximize = () => {
        // While fullscreen, "maximize" just returns to the windowed state.
        if (fullscreen) { collapseFullscreen(); return; }
        currentWindow()?.toggleMaximize?.();
    };
    const close = () => currentWindow()?.close?.();
    // Native window fullscreen: the browser Fullscreen API only fullscreens the
    // webview INSIDE the frameless window, which reads as broken. This is the one
    // fullscreen control; the account-menu entry is hidden in the shell.
    const toggleFullscreen = () => {
        const win = currentWindow();
        if (!win?.setFullscreen) return;
        win.setFullscreen(!fullscreen).then(() => setFullscreen(!fullscreen)).catch(() => { /* no-op */ });
    };

    const btn = 'flex h-full w-11 items-center justify-center text-fg-muted outline-none transition-colors duration-150';

    return (
        <>
            {/* Draggable header strip along the very top edge, present on every
                route (kept short so it never overlaps the nav's own controls
                below it). z sits just under the loading screen so the controls
                stay grabbable even over the full-screen loading/updating
                overlays. */}
            <div data-tauri-drag-region className={`fixed left-0 right-44 top-0 z-[2147483646] h-2.5 transition-opacity duration-150 ${headerVisibility}`} />

            {/* Controls: always on top, always clickable (no drag region). The cluster
                takes a backdrop of its own on hover (each button still tints
                individually): it floats bare over whatever is beneath, which in
                fullscreen is bright video, and the group needs a surface to sit on
                the moment you go for it. Chrome glass, i.e. DARKENING - a white lift
                over HDR video reads milky. */}
            <div className={`fixed right-0 top-0 z-[2147483646] flex h-8 select-none rounded-bl-card transition-[opacity,background-color] duration-150 hover:bg-glass-chrome hover:backdrop-blur-(--glass-blur) ${headerVisibility}`}>
                <button
                    type="button"
                    className={`${btn} hover:bg-white/10 hover:text-fg`}
                    onClick={toggleFullscreen}
                    title={fullscreen ? 'Exit full screen' : 'Full screen'}
                    aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                >
                    {fullscreen ? (
                        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
                            <path d="M4 1v3H1M7 1v3h3M4 10V7H1M7 10V7h3" />
                        </svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
                            <path d="M1 4V1h3M10 4V1H7M1 7v3h3M10 7v3H7" />
                        </svg>
                    )}
                </button>
                <button
                    type="button"
                    className={`${btn} hover:bg-white/10 hover:text-fg`}
                    onClick={minimize}
                    title="Minimize"
                    aria-label="Minimize"
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                        <rect x="1" y="5" width="9" height="1" fill="currentColor" />
                    </svg>
                </button>
                <button
                    type="button"
                    className={`${btn} hover:bg-white/10 hover:text-fg`}
                    onClick={toggleMaximize}
                    title={maximized ? 'Restore' : 'Maximize'}
                    aria-label={maximized ? 'Restore' : 'Maximize'}
                >
                    {maximized ? (
                        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="1.5" y="3.5" width="6" height="6" />
                            <path d="M3.5 3.5V1.5h6v6h-2" />
                        </svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="1.5" y="1.5" width="8" height="8" />
                        </svg>
                    )}
                </button>
                <button
                    type="button"
                    className={`${btn} hover:bg-danger hover:text-white`}
                    onClick={close}
                    title="Close"
                    aria-label="Close"
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
                    </svg>
                </button>
            </div>
        </>
    );
};

export default WindowControls;
