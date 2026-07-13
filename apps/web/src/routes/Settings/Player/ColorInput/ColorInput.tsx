// Copyright (C) 2017-2024 Smart code 203358507

/**
 * ColorInput (Settings/Player) - the subtitle colour pickers. Per decisions.md #3 the
 * legacy a-color-picker is replaced by react-colorful wrapped in the foundation-kit
 * Dialog: a swatch button opens a small dialog with a hex+alpha picker, and Select
 * commits `#rrggbbaa` back through onChange (the same contract usePlayerOptions expects).
 * Transparent detection (alpha == 00), the temp/commit/cancel flow and i18n are preserved.
 */

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HexAlphaColorPicker } from 'react-colorful';
import { Button } from 'rillio/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from 'rillio/components/ui/dialog';
import { cn } from 'rillio/components/ui/cn';

// Normalise any hex-ish value to a lowercase 8-digit #rrggbbaa (the persisted format).
// Mirrors the legacy parseColor fallback of #ffffffff for anything unparseable.
const normalizeHex8 = (input: string): string => {
    const hex = (input || '').trim().replace(/^#/, '');
    let full: string;
    if (hex.length === 3) {
        full = hex.split('').map((c) => c + c).join('') + 'ff';
    } else if (hex.length === 4) {
        full = hex.split('').map((c) => c + c).join('');
    } else if (hex.length === 6) {
        full = hex + 'ff';
    } else if (hex.length === 8) {
        full = hex;
    } else {
        return '#ffffffff';
    }
    return /^[0-9a-fA-F]{8}$/.test(full) ? `#${full.toLowerCase()}` : '#ffffffff';
};

type Props = {
    className?: string,
    value: string,
    onChange?: (value: string) => void,
};

const ColorInput = ({ className, value, onChange }: Props) => {
    const { t } = useTranslation();
    const [modalOpen, setModalOpen] = useState(false);
    const [tempValue, setTempValue] = useState(() => normalizeHex8(value));

    const isTransparent = useMemo(() => normalizeHex8(value).endsWith('00'), [value]);

    // Reset the working colour to the persisted value whenever the picker opens.
    useLayoutEffect(() => {
        setTempValue(normalizeHex8(value));
    }, [value, modalOpen]);

    const onSelectColor = useCallback(() => {
        if (typeof onChange === 'function') {
            onChange(normalizeHex8(tempValue));
        }
        setModalOpen(false);
    }, [tempValue, onChange]);

    return (
        <>
            <Button
                variant="ghost"
                title={isTransparent ? t('BUTTON_COLOR_TRANSPARENT') : value}
                onClick={() => setModalOpen(true)}
                style={{ backgroundColor: value }}
                className={cn(
                    'h-14 w-full rounded-card border-2 border-transparent p-0 transition-colors hover:border-line',
                    className,
                )}
            >
                {
                    isTransparent ?
                        <div className="text-sm font-medium text-fg">{t('BUTTON_COLOR_TRANSPARENT')}</div>
                        :
                        null
                }
            </Button>
            <Dialog open={modalOpen} onOpenChange={(next) => { if (!next) setModalOpen(false); }}>
                <DialogContent className="max-w-xs">
                    <DialogTitle>{t('CHOOSE_COLOR')}</DialogTitle>
                    <div className="flex justify-center py-2 [&_.react-colorful]:w-full">
                        <HexAlphaColorPicker color={tempValue} onChange={(next) => setTempValue(normalizeHex8(next))} />
                    </div>
                    <DialogFooter>
                        <Button onClick={onSelectColor}>
                            {t('SELECT')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ColorInput;
