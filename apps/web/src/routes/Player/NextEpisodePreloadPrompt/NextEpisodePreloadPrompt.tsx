// Copyright (C) 2017-2026 Smart code 203358507

import React from 'react';

// Bottom-right prompt offering to preload the next episode into the cache.
// Styled to match the app's toasts (see common/Toast/ToastItem/styles.less:
// same background, radius, border, shadow, padding, typography and the
// action-button pill idiom) so it reads as a toast sitting at the bottom-right
// of the player. Real toasts stack from the top-right, so this spot never
// collides with them. Rendered as its own positioned element (not a .layer) so
// the immersion CSS that fades the control bar never hides a prompt that is
// waiting for an answer. Mouse handlers are forwarded so hovering it keeps the
// player overlay awake (same contract as the control bar's immersePrevented).

type Props = {
    onAccept?: React.MouseEventHandler<HTMLButtonElement>;
    onDismiss?: React.MouseEventHandler<HTMLButtonElement>;
    onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
    onMouseOver?: React.MouseEventHandler<HTMLDivElement>;
};

const NextEpisodePreloadPrompt = ({ onAccept, onDismiss, onMouseMove, onMouseOver }: Props) => {
    return (
        <div
            className={'absolute bottom-28 right-6 z-10 flex w-[min(25rem,calc(100vw-3rem))] flex-col gap-2 rounded-card border border-line bg-(--modal-background-color) p-4 shadow-(--outer-glow) backdrop-blur-[10px]'}
            onMouseMove={onMouseMove}
            onMouseOver={onMouseOver}
        >
            <div className={'text-[1.2rem] font-semibold text-fg'}>
                Preload the next episode too?
            </div>
            <div className={'flex flex-wrap items-center gap-2'}>
                <button
                    type={'button'}
                    onClick={onAccept}
                    className={'inline-flex items-center justify-center rounded-full border border-transparent bg-accent px-[1.2rem] py-[0.3rem] text-[1.1rem] font-semibold text-bg transition hover:brightness-110'}
                >
                    Preload
                </button>
                <button
                    type={'button'}
                    onClick={onDismiss}
                    className={'inline-flex items-center justify-center rounded-full border border-line bg-(--overlay-color) px-[1.2rem] py-[0.3rem] text-[1.1rem] font-semibold text-fg transition hover:brightness-110'}
                >
                    Cancel
                </button>
            </div>
            <div className={'text-[0.95rem] leading-relaxed text-fg-subtle'}>
                You can turn this off for all series in Settings.
            </div>
        </div>
    );
};

export default NextEpisodePreloadPrompt;
