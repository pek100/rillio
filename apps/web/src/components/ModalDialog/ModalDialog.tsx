// Copyright (C) 2017-2024 Smart code 203358507

/**
 * ModalDialog - clean-room rewrite onto the foundation-kit Dialog (Radix).
 *
 * The public API is preserved exactly so existing consumers (MetaDetails'
 * meta-extension modal, AddonDetailsModal) stay unchanged:
 *   - title: optional string header
 *   - buttons: [{ className, label, icon, props }] descriptor rendered as a footer
 *   - children: modal body
 *   - dataset / onCloseRequest({ type: 'close', dataset, reactEvent?, nativeEvent? })
 *   - background: image URL painted at 0.1 opacity behind the content
 *   - className: passthrough onto the dialog surface
 *   - icon: dynamic string -> lucide via ICON_MAP (close/checkmark/add)
 *
 * Radix Dialog now provides focus-trap, Escape, scroll-lock, outside-click and
 * aria for free, replacing the hand-rolled Modal portal + manual keydown + backdrop
 * mousedown that the legacy version carried.
 *
 * Fixes over the legacy visuals (per the rewrite mandate; behavior/API unchanged):
 *   - consistent control rhythm: action buttons are one flat rounded-full row at a
 *     single h-11 height (was 3.5rem tall with a 1.2rem inner padding and ad-hoc
 *     1rem right margins between buttons);
 *   - consistent surface padding on the Tailwind scale (was mixed 0/2rem/4.5rem);
 *   - one accent color via the kit Button default variant; per-button className
 *     overrides still win by specificity, so AddonDetailsModal's cancel/uninstall
 *     styling is unaffected.
 */

import React, { useCallback, type ReactNode } from 'react';
import { X, Check, Plus, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from 'rillio/components/ui/dialog';
import { Button, type ButtonProps } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';

// Dynamic string-icon handling: the icon names the buttons[] descriptor may carry,
// mapped to the lucide glyphs that replaced the stremio-icons font.
const ICON_MAP: Record<string, LucideIcon> = { close: X, checkmark: Check, add: Plus };

export type ModalDialogCloseEvent = {
    type: 'close';
    dataset?: Record<string, unknown>;
    reactEvent?: React.SyntheticEvent;
    nativeEvent?: Event;
};

export type ModalDialogButton = {
    className?: string;
    label?: string;
    icon?: string;
    props?: Partial<ButtonProps>;
};

export type ModalDialogProps = {
    className?: string;
    title?: string;
    background?: string | null;
    buttons?: ModalDialogButton[];
    children?: ReactNode;
    dataset?: Record<string, unknown>;
    onCloseRequest?: (event: ModalDialogCloseEvent) => void;
};

const ModalDialog = ({ className, title, buttons, children, dataset, onCloseRequest, background }: ModalDialogProps) => {
    // Radix funnels the close button, Escape and outside-click through a single
    // onOpenChange(false). We surface it as the legacy onCloseRequest close event.
    const requestClose = useCallback(() => {
        if (typeof onCloseRequest === 'function') {
            onCloseRequest({ type: 'close', dataset });
        }
    }, [dataset, onCloseRequest]);

    const hasTitle = typeof title === 'string' && title.length > 0;
    const hasButtons = Array.isArray(buttons) && buttons.length > 0;

    return (
        <Dialog open onOpenChange={(next) => { if (!next) requestClose(); }}>
            <DialogContent
                className={cn(
                    // Size to content up to the viewport (legacy was 80% x 80%), scroll the
                    // body; override the kit's centered max-w-lg + grid/p-6 defaults.
                    'flex w-auto max-w-[min(80vw,60rem)] max-h-[85vh] flex-col gap-0 overflow-hidden p-0',
                    className,
                )}
            >
                {typeof background === 'string' && background.length > 0 ? (
                    <div
                        className="pointer-events-none absolute inset-0 rounded-squircle bg-cover bg-center opacity-10"
                        style={{ backgroundImage: `url('${background}')` }}
                    />
                ) : null}
                <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
                    {hasTitle ? (
                        <DialogTitle className="mb-6 pr-8 text-xl font-semibold text-fg">{title}</DialogTitle>
                    ) : (
                        // Radix requires a title for the dialog to be announced.
                        <DialogTitle className="sr-only">Dialog</DialogTitle>
                    )}
                    <div className="min-h-0 flex-1">{children}</div>
                    {hasButtons ? (
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            {buttons!.map(({ className: buttonClassName, label, icon, props }, index) => {
                                const Icon = typeof icon === 'string' ? ICON_MAP[icon] : undefined;
                                return (
                                    <Button
                                        key={index}
                                        title={label}
                                        {...props}
                                        className={cn('h-11 flex-1', buttonClassName)}
                                    >
                                        {Icon ? <Icon className="size-5" /> : null}
                                        {typeof label === 'string' && label.length > 0 ? <span>{label}</span> : null}
                                    </Button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ModalDialog;
