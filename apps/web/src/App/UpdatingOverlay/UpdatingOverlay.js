const React = require('react');
const { default: Logo } = require('rillio/common/Logo/Logo');
const { getTauri } = require('rillio/common/Platform/shell/isShell');
const styles = require('./styles.less');

// Full-screen overlay shown after the user accepts a desktop update. It stays up
// through download + install until the native shell restarts into the new
// version. Driven by window events from the update toast (`rillio:update-start` /
// `rillio:update-error`) plus the shell's `update-progress` Tauri event.
const UpdatingOverlay = () => {
    const [active, setActive] = React.useState(false);
    const [pct, setPct] = React.useState(null);
    const [fellBack, setFellBack] = React.useState(false);
    const canvasRef = React.useRef(null);

    // Drive the looping fluid-fill mark (the same animation as the pre-bundle
    // loading screen, exposed on window) once the overlay is showing. The frame
    // loop stops itself when the canvas leaves the DOM (overlay hidden).
    React.useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        const run = globalThis.__rillioFluidLogo;
        if (canvas && typeof run === 'function') {
            run(canvas, { fallback: () => setFellBack(true) });
        } else {
            setFellBack(true);
        }
    }, [active]);

    React.useEffect(() => {
        const onStart = () => { setPct(null); setActive(true); };
        const onError = () => setActive(false);
        window.addEventListener('rillio:update-start', onStart);
        window.addEventListener('rillio:update-error', onError);

        const TAURI = getTauri();
        let unlisten;
        let cancelled = false;
        if (TAURI?.event?.listen) {
            TAURI.event.listen('update-progress', (event) => {
                setActive(true);
                const p = event?.payload;
                if (p && p.total) {
                    setPct(Math.max(0, Math.min(100, Math.round((p.downloaded / p.total) * 100))));
                }
            }).then((un) => { if (cancelled) un(); else unlisten = un; }).catch(() => { /* not in shell */ });
        }

        return () => {
            window.removeEventListener('rillio:update-start', onStart);
            window.removeEventListener('rillio:update-error', onError);
            cancelled = true;
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    if (!active) return null;

    return (
        // The whole bare surface is a window drag region (it has no other
        // interactive elements); the floating window controls sit above it.
        <div className={styles['overlay']} data-tauri-drag-region>
            <div className={styles['mark']}>
                {fellBack
                    ? <Logo className={styles['mark-fallback']} size={92} />
                    : <canvas ref={canvasRef} className={styles['mark-canvas']} width={360} height={371} />}
            </div>
            <div className={styles['title']}>Updating Rillio</div>
            <div className={styles['track']}>
                <div
                    className={pct === null ? styles['fill-indeterminate'] : styles['fill']}
                    style={pct === null ? undefined : { width: `${pct}%` }}
                />
            </div>
            <div className={styles['hint']}>{pct === null ? 'Downloading the update' : `${pct}%`}</div>
            <div className={styles['note']}>Rillio will restart when it is done.</div>
        </div>
    );
};

module.exports = UpdatingOverlay;
