// Copyright (C) 2017-2026 Smart code 203358507

/**
 * AnimatedPercentage - slot-machine progress text: only the characters that
 * CHANGE animate (the new digit slides in from below), so a ticking percentage
 * reads as live machinery instead of flickering text.
 *
 * Idea from hydralauncher/hydra's downloads page (MIT). Their implementation
 * (per-char AnimatePresence mode="wait" exit animations) desyncs when updates
 * arrive faster than the exit transition - progress events do - leaving stale
 * digits in the DOM ("110%"). This version keeps the effect but not the race:
 * a changed char REMOUNTS (key carries the char) and plays a CSS enter
 * animation; the old char unmounts instantly. No exit phase, nothing to
 * orphan - and it follows the kit's CSS-first rule (tw-animate-css) anyway.
 * Wrapper keeps tabular-nums so digits do not jitter horizontally.
 */

import React from 'react';

type Props = {
    /** The rendered text (e.g. "42%" or "3.2 MB/s"); any short string works. */
    text: string,
};

const AnimatedPercentage = ({ text }: Props) => (
    <span className="inline-block overflow-hidden align-bottom leading-[1.2] [font-variant-numeric:tabular-nums]">
        {text.split('').map((char, index) => (
            <span
                // char in the key: a changed char is a NEW element, so the enter
                // animation plays; an unchanged char keeps its element, so it
                // stays still.
                key={`${index}-${char}`}
                className="inline-block animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
                {char}
            </span>
        ))}
    </span>
);

export default AnimatedPercentage;
