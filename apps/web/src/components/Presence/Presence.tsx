// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Presence - the motion-based replacement for the legacy CSS-class `Transition`
 * primitive. Mounts its children while `when` is true and animates them in/out with
 * `motion` (AnimatePresence keeps them mounted through the exit tween, exactly like
 * the old `${name}-enter/-active/-exit` class dance did). Two presets cover every
 * former Transition call site: `fade` (player menus, context menu, HUD indicator) and
 * `slideUp` (the updater banner rising from the bottom edge).
 *
 * A thin animated wrapper element carries the motion; positioned children (the
 * absolutely-placed menu layers, the fixed context-menu backdrop) resolve their
 * offsets against the same positioned ancestor as before, so layout is unchanged.
 */

import React, { type ReactNode } from 'react';
import { AnimatePresence, m, type Variants } from 'motion/react';
import { LazyMotionProvider } from 'rillio/components/ui/motion';

type Variant = 'fade' | 'slideUp';

const VARIANTS: Record<Variant, Variants> = {
    fade: {
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
    },
    slideUp: {
        hidden: { y: '100%' },
        visible: { y: '0%' },
    },
};

// Match the legacy timings: the fade was a 100ms opacity tween, the banner slide a
// 300ms transform, both on the same cubic-bezier easing.
const DEFAULT_DURATION_MS: Record<Variant, number> = { fade: 100, slideUp: 300 };
const EASE = [0.32, 0, 0.67, 0] as const;

type Props = {
    when: boolean;
    children: ReactNode;
    variant?: Variant;
    duration?: number;
    className?: string;
};

const Presence = ({ when, children, variant = 'fade', duration, className }: Props) => {
    const durationMs = typeof duration === 'number' ? duration : DEFAULT_DURATION_MS[variant];
    return (
        <LazyMotionProvider>
            <AnimatePresence>
                {when ? (
                    <m.div
                        className={className}
                        variants={VARIANTS[variant]}
                        initial={'hidden'}
                        animate={'visible'}
                        exit={'hidden'}
                        transition={{ duration: durationMs / 1000, ease: EASE }}
                    >
                        {children}
                    </m.div>
                ) : null}
            </AnimatePresence>
        </LazyMotionProvider>
    );
};

export default Presence;
