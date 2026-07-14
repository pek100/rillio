// Copyright (C) 2017-2024 Smart code 203358507

/**
 * useToast adapter (foundation kit) - re-implements the app's toast context over
 * Sonner while preserving the EXACT existing API surface, so every call site stays
 * unchanged (see common/Toast/ToastProvider.js for the contract this mirrors):
 *
 *   const toast = useToast();
 *   toast.show({ type, title, message, icon?, timeout?, action?, dataset? }) -> id | null
 *   toast.remove(id); toast.clear();
 *   toast.addFilter(fn); toast.removeFilter(fn);   // fn(item) -> true suppresses
 *
 * Fidelity notes:
 *  - type maps to Sonner: success/info/error pass through; 'alert' -> 'warning'.
 *  - filters run BEFORE toast() exactly like the old provider (any true = suppressed).
 *  - item.icon (stremio icon NAME) renders via the custom-icon slot; else a per-type
 *    default (checkmark / close / about / warning).
 *  - action { label, onSelect } -> Sonner { label, onClick }.
 *  - onClose fires on dismiss/auto-close with the legacy {type,dataset,...} payload.
 */

import React, { createElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast as sonnerToast } from 'sonner';
import { Check, X, Info, TriangleAlert, Download, type LucideIcon } from 'lucide-react';
import { Toaster } from './sonner';

const DEFAULT_TIMEOUT = 3000;

export type ToastType = 'success' | 'alert' | 'info' | 'error';

export type ToastItem = {
    type?: ToastType;
    title?: string;
    message?: string;
    icon?: string;
    timeout?: number;
    action?: { label: string; onSelect: () => void };
    dataset?: Record<string, unknown>;
    onSelect?: (event: { type: string; dataset?: Record<string, unknown> }) => void;
    onClose?: (event: { type: string; dataset?: Record<string, unknown> }) => void;
};

export type ToastFilter = (item: ToastItem) => boolean;

const DEFAULT_ICON: Record<ToastType, string> = {
    success: 'checkmark',
    error: 'close',
    info: 'about',
    alert: 'warning',
};

const TOAST_ICON: Record<string, LucideIcon> = {
    checkmark: Check,
    close: X,
    about: Info,
    warning: TriangleAlert,
    download: Download,
};

// Module-level filters, mirroring the closure array in the legacy provider.
const filters: ToastFilter[] = [];

function iconFor(item: ToastItem): ReactNode {
    const name = typeof item.icon === 'string' && item.icon.length > 0
        ? item.icon
        : DEFAULT_ICON[item.type ?? 'success'];
    const Cmp = TOAST_ICON[name] ?? Info;
    return createElement(Cmp, { className: 'size-5' });
}

function invoke(type: string, item: ToastItem, cb?: ToastItem['onSelect'] | ToastItem['onClose']) {
    if (typeof cb === 'function') {
        cb({ type, dataset: item.dataset });
    }
}

const toastApi = {
    addFilter(filter: ToastFilter) {
        filters.push(filter);
    },
    removeFilter(filter: ToastFilter) {
        const index = filters.indexOf(filter);
        if (index > -1) filters.splice(index, 1);
    },
    show(item: ToastItem): string | number | null {
        if (filters.some((filter) => filter(item))) {
            return null;
        }
        const duration = typeof item.timeout === 'number' && !isNaN(item.timeout) ? item.timeout : DEFAULT_TIMEOUT;
        const kind = item.type === 'alert' ? 'warning' : (item.type ?? 'success');
        const emitter: (message: ReactNode, data?: Record<string, unknown>) => string | number =
            kind === 'warning' ? sonnerToast.warning
                : kind === 'error' ? sonnerToast.error
                    : kind === 'info' ? sonnerToast.info
                        : sonnerToast.success;

        return emitter(item.title ?? '', {
            description: item.message,
            duration,
            icon: iconFor(item),
            action: item.action
                ? { label: item.action.label, onClick: () => { item.action!.onSelect(); invoke('close', item, item.onClose); } }
                : undefined,
            onDismiss: () => invoke('close', item, item.onClose),
            onAutoClose: () => invoke('close', item, item.onClose),
        });
    },
    remove(id: string | number) {
        sonnerToast.dismiss(id);
    },
    clear() {
        sonnerToast.dismiss();
    },
};

export type ToastApi = typeof toastApi;

/** Drop-in replacement for the legacy useToast() hook (returns a stable facade). */
export function useToast(): ToastApi {
    return toastApi;
}

/**
 * ToastProvider - parity wrapper for the legacy provider. Sonner is imperative and
 * global, so there is no context to thread; this simply renders children plus the
 * single <Toaster/>. Kept so existing `<ToastProvider>` mount points need no change.
 *
 * The Toaster is PORTALLED TO document.body, and that is load-bearing. This provider
 * mounts inside `#app`, which is `position: relative; z-index: 0` - a stacking
 * context. A z-index only competes with siblings INSIDE its own stacking context, so
 * sonner's z-index:999999999 does not escape `#app`: the whole toast layer flattens
 * to `#app`'s z-index 0. Radix portals every dialog to <body> at z-index 50, which
 * therefore paints above ALL of `#app` - scrim included. Left inline, any toast
 * raised while a modal is open (a Cached pause/delete error, a download starting
 * from Search) renders underneath the scrim and is never seen. Portalling makes the
 * toaster a sibling of the dialog portals, where its z-index finally means what it
 * says. Verified over CDP: elementFromPoint at the toast's centre returned the
 * dialog's `.fixed.inset-0` overlay before this, and the toast after.
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
    return (
        <>
            {children}
            {createPortal(<Toaster />, document.body)}
        </>
    );
}

export default useToast;
