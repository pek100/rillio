// Copyright (C) 2017-2026 Smart code 203358507

/**
 * SpeedChart - a live bar chart of recent transfer speeds on a canvas: rounded
 * track bars at 8% foreground, filled bars in the accent with a subtle vertical
 * alpha gradient. The newest sample is the rightmost bar.
 *
 * Adapted from hydralauncher/hydra's downloads page (MIT). Differences: the
 * color comes from the house --color-accent token (resolved at draw time, so
 * theming keeps working), and it draws on data/resize changes instead of a
 * continuous requestAnimationFrame loop (same look, no idle GPU churn).
 */

import React, { useEffect, useRef } from 'react';

type Props = {
    /** Recent speed samples (any unit; only relative heights matter). */
    speeds: number[],
    /** Fixed scale ceiling; defaults to the max of the current samples. */
    peakSpeed?: number,
    /** Canvas CSS height in px. */
    height?: number,
    className?: string,
};

const BAR_WIDTH = 4;
const BAR_GAP = 10;
const FALLBACK_ACCENT = '#FFA033';

const parseColor = (raw: string): [number, number, number] => {
    const value = raw.trim();
    if (value.startsWith('#')) {
        let hex = value.slice(1);
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
        return [
            parseInt(hex.slice(0, 2), 16) || 255,
            parseInt(hex.slice(2, 4), 16) || 255,
            parseInt(hex.slice(4, 6), 16) || 255,
        ];
    }
    const matches = value.match(/\d+/g);
    if (matches && matches.length >= 3) {
        return [parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2])];
    }
    return parseColor(FALLBACK_ACCENT);
};

const SpeedChart = ({ speeds, peakSpeed, height = 80, className }: Props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const draw = () => {
            const width = canvas.clientWidth;
            if (width === 0) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);

            const accent = getComputedStyle(canvas).getPropertyValue('--color-accent') || FALLBACK_ACCENT;
            const [r, g, b] = parseColor(accent);

            const barSpacing = BAR_WIDTH + BAR_GAP;
            const totalBars = Math.max(1, Math.floor((width + BAR_GAP) / barSpacing));
            const maxHeight = peakSpeed || Math.max(...speeds, 1);
            const displaySpeeds = speeds.slice(-totalBars);
            // Right-align the newest sample so the chart fills from the right.
            const offset = totalBars - displaySpeeds.length;

            ctx.clearRect(0, 0, width, height);
            for (let i = 0; i < totalBars; i++) {
                const x = i * barSpacing;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.beginPath();
                ctx.roundRect(x, 0, BAR_WIDTH, height, 3);
                ctx.fill();

                const sample = i >= offset ? (displaySpeeds[i - offset] || 0) : 0;
                const filledHeight = Math.min(height, (sample / maxHeight) * height);
                if (filledHeight > 0) {
                    const gradient = ctx.createLinearGradient(0, height - filledHeight, 0, height);
                    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
                    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.7)`);
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.roundRect(x, height - filledHeight, BAR_WIDTH, filledHeight, 3);
                    ctx.fill();
                }
            }
        };

        draw();
        const resizeObserver = new ResizeObserver(draw);
        resizeObserver.observe(canvas);
        return () => resizeObserver.disconnect();
    }, [speeds, peakSpeed, height]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            style={{ width: '100%', height: `${height}px` }}
        />
    );
};

export default SpeedChart;
