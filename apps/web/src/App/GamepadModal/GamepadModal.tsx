// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Gamepad controls reference modal. Ported onto the kit Dialog: Radix owns the
 * focus-trap, Escape-to-close, scroll-lock, outside-click dismiss and focus restore,
 * so the hand-rolled portal + backdrop + keydown listener retire. The gamepad
 * integration is sacred and kept verbatim: the modal locks input to the `gamepad-`
 * scope while open and closes on the B / circle button. Open is controlled (the modal
 * is mounted while its binary state is open), never a DialogTrigger.
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui';
import { useGamepad } from 'rillio/services';
import type { ControllerType } from 'rillio/services/GamepadContext';
import GamepadDiagram from './GamepadDiagram';

const LEFT = '←';
const RIGHT = '→';
const UP = '↑';
const DOWN = '↓';

type FaceLabels = {
    bottom: string;
    right: string;
    left: string;
    top: string;
    lb: string;
    rb: string;
    lStick: string;
    rStick: string;
};

const LABELS: Record<ControllerType, FaceLabels> = {
    playstation: {
        bottom: '✕', right: '○', left: '□', top: '△',
        lb: 'L1', rb: 'R1',
        lStick: 'L stick', rStick: 'R stick',
    },
    xbox: {
        bottom: 'A', right: 'B', left: 'X', top: 'Y',
        lb: 'LB', rb: 'RB',
        lStick: 'L stick', rStick: 'R stick',
    },
    generic: {
        bottom: '✕', right: '○', left: '□', top: '△',
        lb: 'L1', rb: 'R1',
        lStick: 'L stick', rStick: 'R stick',
    },
};

type MappingProps = {
    keyLabel: string,
    dir?: string,
    action: string,
};

const Mapping = ({ keyLabel, dir, action }: MappingProps) => (
    <div className="grid grid-cols-[auto_1.2rem_1fr] items-center gap-x-2">
        <kbd className="inline-flex h-[1.8rem] min-w-8 items-center justify-center rounded-[0.35rem] border border-line bg-surface-hover px-2 text-sm font-semibold text-fg">
            {keyLabel}
        </kbd>
        <span className="text-base text-fg-subtle">{dir}</span>
        <span className="text-sm text-fg opacity-80">{action}</span>
    </div>
);

type Props = {
    onClose: () => void,
};

const GamepadModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const gamepad = useGamepad();

    const labels = LABELS[gamepad?.controllerType ?? 'generic'];

    useEffect(() => {
        gamepad?.lock('gamepad-');
        gamepad?.on('buttonB', 'gamepad-modal', onClose);
        return () => {
            gamepad?.off('buttonB', 'gamepad-modal');
            gamepad?.unlock();
        };
    }, [gamepad]);

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent className="flex max-h-[90vh] w-[92vw] max-w-[72rem] flex-col gap-8 overflow-y-auto">
                <DialogTitle className="pr-8 text-2xl font-semibold">
                    {t('GAMEPAD_CONTROLS_TITLE')}
                </DialogTitle>

                <div className="flex flex-col items-center gap-12">
                    <GamepadDiagram />

                    <div className="flex w-full max-w-[56rem] flex-row gap-20 overflow-visible max-[640px]:flex-col max-[640px]:gap-8">
                        <div className="flex flex-1 flex-col gap-[1.2rem] overflow-visible">
                            <div className="mb-1 text-base font-semibold uppercase tracking-[0.05em] text-fg opacity-70">
                                {t('GAMEPAD_SECTION_NAVIGATION')}
                            </div>
                            <Mapping keyLabel={labels.lStick} action={t('GAMEPAD_ACTION_NAVIGATE')} />
                            <Mapping keyLabel={labels.bottom} action={t('GAMEPAD_ACTION_SELECT')} />
                            <Mapping keyLabel={labels.right} action={t('GAMEPAD_ACTION_BACK')} />
                            <Mapping keyLabel={labels.top} action={t('GAMEPAD_ACTION_FULLSCREEN')} />
                            <Mapping keyLabel={labels.left} action={t('GAMEPAD_ACTION_GUIDE')} />
                            <Mapping keyLabel={labels.lb} action={t('GAMEPAD_ACTION_PREV_TAB')} />
                            <Mapping keyLabel={labels.rb} action={t('GAMEPAD_ACTION_NEXT_TAB')} />
                        </div>

                        <div className="flex flex-1 flex-col gap-[1.2rem] overflow-visible">
                            <div className="mb-1 text-base font-semibold uppercase tracking-[0.05em] text-fg opacity-70">
                                {t('GAMEPAD_SECTION_PLAYER')}
                            </div>
                            <Mapping keyLabel={labels.left} action={t('GAMEPAD_ACTION_PLAY_PAUSE')} />
                            <Mapping keyLabel={labels.rStick} dir={LEFT} action={t('GAMEPAD_ACTION_SEEK_BACK')} />
                            <Mapping keyLabel={labels.rStick} dir={RIGHT} action={t('GAMEPAD_ACTION_SEEK_FWD')} />
                            <Mapping keyLabel={labels.rStick} dir={UP} action={t('GAMEPAD_ACTION_VOL_UP')} />
                            <Mapping keyLabel={labels.rStick} dir={DOWN} action={t('GAMEPAD_ACTION_VOL_DOWN')} />
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default GamepadModal;
