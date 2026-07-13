// Copyright (C) 2017-2025 Smart code 203358507

/**
 * DisplayNameEdit - inline click-to-edit display name. Clean-room Tailwind but the
 * component stays CUSTOM per the UI-rewrite decisions: it owns the edit state
 * machine (autofocus + select-all, Enter commits, Escape cancels, blur commits) and
 * the delicate stopPropagation contract so a hosting account dropdown stays open.
 * Empty-input handling belongs to the owner (setDisplayName reverts an empty name to
 * a fresh random handle). Sizing is tuned per call site through the --display-name-*
 * custom properties on the wrapper class passed as className.
 *
 * The edit field is the foundation-kit Input (re-styled to the inline look); the
 * pencil trigger is deliberately custom (row-hover reveal + icon color change),
 * not the kit IconButton, so it matches the reference exactly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import { Input } from 'rillio/components/ui/input';

type Props = {
    className?: string,
    value: string,
    maxLength?: number,
    onCommit: (value: string) => void,
};

const DisplayNameEdit = ({ className, value, maxLength = 40, onCommit }: Props) => {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        setDraft(value);
        setEditing(true);
    }, [value]);
    const commit = useCallback(() => {
        onCommit(draft);
        setEditing(false);
    }, [draft, onCommit]);
    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
    }, [commit]);
    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    return (
        <div className={cn('group flex items-center gap-2', className)}>
            {
                editing ?
                    <Input
                        ref={inputRef}
                        className={cn(
                            'h-auto min-w-0 flex-1 rounded-[0.4rem] border border-line bg-[var(--overlay-color)] px-[0.45rem] py-[0.15rem]',
                            'text-[length:var(--display-name-size,1.05rem)] font-bold text-fg',
                            'focus-visible:outline-none focus:border-highlight',
                        )}
                        value={draft}
                        maxLength={maxLength}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={commit}
                        onClick={(event) => event.stopPropagation()}
                    />
                    :
                    <>
                        <div
                            className="max-w-[var(--display-name-max-width,13rem)] overflow-hidden text-ellipsis whitespace-nowrap text-[length:var(--display-name-size,1.05rem)] font-bold text-fg"
                            title={value}
                        >
                            {value}
                        </div>
                        <Button
                            variant="ghost"
                            className="size-auto flex-none p-0 opacity-50 transition-opacity hover:bg-transparent group-hover:opacity-100 [&:hover_svg]:text-fg"
                            title={t('EDIT') || 'Edit name'}
                            onClick={startEdit}
                        >
                            <Pencil
                                className="block size-[var(--display-name-icon-size,0.85rem)] text-fg-subtle transition-colors"
                            />
                        </Button>
                    </>
            }
        </div>
    );
};

export default DisplayNameEdit;
