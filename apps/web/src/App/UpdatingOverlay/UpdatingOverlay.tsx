// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Full-screen overlay shown after the user accepts a desktop update. It stays up
 * through download + install until the native shell restarts into the new version.
 * Driven by window events from the update toast (`rillio:update-start` /
 * `rillio:update-error`) plus the shell's `update-progress` Tauri event (mirrored
 * as the `rillio:update-progress` window event so the overlay is drivable and
 * testable outside the shell).
 *
 * The looping fluid-fill mark is a shipped brand moment (the same WebGL animation as
 * the pre-bundle loading screen, exposed on `window.__rillioFluidLogo`); it is kept
 * exactly, canvas-driven, with the static Logo as the WebGL-unavailable fallback.
 *
 * The download telemetry below it - slot-machine percentage, live speed chart,
 * glass stats row - is the install animation from hydralauncher/hydra's downloads
 * page (MIT), rebranded: their game logo slot is our fluid-fill mark, their
 * artwork tint is the house accent.
 */

import React, { useEffect, useRef, useState } from 'react';
import Logo from 'rillio/common/Logo/Logo';
import AnimatedPercentage from 'rillio/components/ui/animated-percentage';
import SpeedChart from 'rillio/components/ui/speed-chart';
import { getTauri } from 'rillio/common/Platform/shell/isShell';

type FluidLogo = (canvas: HTMLCanvasElement, options: { fallback: () => void }) => void;

type ProgressPayload = { downloaded?: number, total?: number };

// Sample the speed at most this often: the Tauri updater emits per-chunk, and
// unthrottled samples would scroll the chart into a blur.
const SAMPLE_MS = 250;
const HISTORY_LENGTH = 64;

const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`;

const formatEta = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '-';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// Was UpdatingOverlay/styles.less. The looping fluid-fill mark is canvas-driven
// (window.__rillioFluidLogo); the updating-pulse (fallback logo) + updating-slide
// (indeterminate bar) keyframes live in styles/tailwind.css.
const S = {
    overlay: 'fixed inset-0 z-[2147483000] flex flex-col items-center justify-center gap-6 bg-bg',
    mark: 'flex items-center justify-center [filter:drop-shadow(0_8px_30px_rgba(255,160,51,0.2))]',
    markCanvas: 'w-[92px] h-[95px]',
    markFallback: 'w-[92px] h-[95px] animate-[updating-pulse_1.6s_ease-in-out_infinite]',
    title: 'text-[1.15rem] font-bold tracking-[-0.01em] text-fg/97',
    track: 'w-[220px] h-1 rounded-full bg-fg/8 overflow-hidden',
    fill: 'h-full rounded-[inherit] bg-accent [transition:width_0.3s_ease]',
    fillIndeterminate: 'h-full w-[42%] rounded-[inherit] bg-accent animate-[updating-slide_1.15s_ease-in-out_infinite]',
    pct: 'text-[2rem] font-bold leading-none tracking-[-0.02em] text-fg',
    hint: 'text-[0.85rem] text-fg/53 [font-variant-numeric:tabular-nums]',
    stats: 'flex w-[340px] flex-col gap-3 rounded-xl border border-line bg-fg/4 px-4 py-3 backdrop-blur-lg',
    statRow: 'flex items-baseline justify-between text-[0.8rem] [font-variant-numeric:tabular-nums]',
    statLabel: 'text-[0.68rem] font-semibold uppercase tracking-wider text-fg/45',
    statValue: 'font-semibold text-fg/90',
    note: '-mt-2 text-[0.8rem] text-fg/34',
};

const UpdatingOverlay = () => {
    const [active, setActive] = useState(false);
    const [pct, setPct] = useState<number | null>(null);
    const [fellBack, setFellBack] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Live download telemetry, fed by the progress events.
    const [speeds, setSpeeds] = useState<number[]>([]);
    const [stats, setStats] = useState<{ downloaded: number, total: number, speed: number } | null>(null);
    const peakRef = useRef(0);
    const lastSampleRef = useRef<{ t: number, bytes: number } | null>(null);

    // Drive the looping fluid-fill mark (the same animation as the pre-bundle
    // loading screen, exposed on window) once the overlay is showing. The frame
    // loop stops itself when the canvas leaves the DOM (overlay hidden).
    useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        const run = (globalThis as unknown as { __rillioFluidLogo?: FluidLogo }).__rillioFluidLogo;
        if (canvas && typeof run === 'function') {
            run(canvas, { fallback: () => setFellBack(true) });
        } else {
            setFellBack(true);
        }
    }, [active]);

    useEffect(() => {
        const onProgress = (payload: ProgressPayload | undefined) => {
            setActive(true);
            if (!payload || !payload.total) return;
            const downloaded = payload.downloaded ?? 0;
            const total = payload.total;
            setPct(Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))));

            const now = performance.now();
            const last = lastSampleRef.current;
            if (last === null) {
                lastSampleRef.current = { t: now, bytes: downloaded };
                setStats({ downloaded, total, speed: 0 });
                return;
            }
            if (now - last.t < SAMPLE_MS) {
                setStats((s) => ({ downloaded, total, speed: s?.speed ?? 0 }));
                return;
            }
            const speed = Math.max(0, (downloaded - last.bytes) / ((now - last.t) / 1000));
            lastSampleRef.current = { t: now, bytes: downloaded };
            peakRef.current = Math.max(peakRef.current, speed);
            setSpeeds((h) => [...h, speed].slice(-HISTORY_LENGTH));
            setStats({ downloaded, total, speed });
        };

        const onStart = () => {
            setPct(null);
            setSpeeds([]);
            setStats(null);
            peakRef.current = 0;
            lastSampleRef.current = null;
            setActive(true);
        };
        const onError = () => setActive(false);
        const onWindowProgress = (event: Event) => onProgress((event as CustomEvent).detail);
        window.addEventListener('rillio:update-start', onStart);
        window.addEventListener('rillio:update-error', onError);
        window.addEventListener('rillio:update-progress', onWindowProgress);

        const TAURI = getTauri();
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        if (TAURI?.event?.listen) {
            TAURI.event.listen('update-progress', (event: { payload?: ProgressPayload }) => {
                onProgress(event?.payload);
            }).then((un: () => void) => { if (cancelled) un(); else unlisten = un; }).catch(() => { /* not in shell */ });
        }

        return () => {
            window.removeEventListener('rillio:update-start', onStart);
            window.removeEventListener('rillio:update-error', onError);
            window.removeEventListener('rillio:update-progress', onWindowProgress);
            cancelled = true;
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    if (!active) return null;

    const etaSeconds = stats !== null && stats.speed > 0 ?
        (stats.total - stats.downloaded) / stats.speed :
        NaN;

    return (
        // The whole bare surface is a window drag region (it has no other
        // interactive elements); the floating window controls sit above it.
        <div className={S.overlay} data-tauri-drag-region>
            <div className={S.mark}>
                {fellBack
                    ? <Logo className={S.markFallback} size={92} />
                    : <canvas ref={canvasRef} className={S.markCanvas} width={360} height={371} />}
            </div>
            <div className={S.title}>Updating Rillio</div>
            <div className={S.track}>
                <div
                    className={pct === null ? S.fillIndeterminate : S.fill}
                    style={pct === null ? undefined : { width: `${pct}%` }}
                />
            </div>
            {
                pct === null ?
                    <div className={S.hint}>Downloading the update</div>
                    :
                    <>
                        <div className={S.pct}>
                            <AnimatedPercentage text={`${pct}%`} />
                        </div>
                        {
                            stats !== null ?
                                <div className={S.stats}>
                                    <SpeedChart speeds={speeds} peakSpeed={peakRef.current} height={56} />
                                    <div className={S.statRow}>
                                        <span className={S.statLabel}>Speed</span>
                                        <span className={S.statValue}>{formatSpeed(stats.speed)}</span>
                                    </div>
                                    <div className={S.statRow}>
                                        <span className={S.statLabel}>Downloaded</span>
                                        <span className={S.statValue}>
                                            {formatBytes(stats.downloaded)}
                                            <span className="text-fg/45">{` / ${formatBytes(stats.total)}`}</span>
                                        </span>
                                    </div>
                                    <div className={S.statRow}>
                                        <span className={S.statLabel}>Time left</span>
                                        <span className={S.statValue}>{formatEta(etaSeconds)}</span>
                                    </div>
                                </div>
                                : null
                        }
                    </>
            }
            <div className={S.note}>Rillio will restart when it is done.</div>
        </div>
    );
};

export default UpdatingOverlay;
