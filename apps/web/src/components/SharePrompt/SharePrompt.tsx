// Copyright (C) 2017-2024 Smart code 203358507

/**
 * SharePrompt - clean-room rewrite onto the foundation kit.
 *
 * Public API preserved: { className?, url }. Consumers: the Addons share modal and
 * MetaPreview's share Dialog (both wrap this in a kit Dialog, so SharePrompt itself
 * is just the body: three brand share buttons + a copyable URL field).
 *
 * Changes from the legacy version:
 *   - clipboard copy migrated from the deprecated document.execCommand('copy') to the
 *     async navigator.clipboard API (with a fail-loud error toast, per house rules);
 *   - flat, borderless design: brand buttons and the URL field share one rounded-full
 *     rhythm at a single h-11 height (was mixed 1rem-padding boxes + a half-rounded
 *     copy button seamed onto the input);
 *   - brand icons come from the kit brand-icons, brand colors from the shared tokens.
 * The auto-select-on-focus ergonomics and share-intent URLs are unchanged.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'lucide-react';
import { Facebook, XSocial, Reddit } from 'rillio/components/ui/brand-icons';
import { Button } from 'rillio/components/ui/button';
import { Input } from 'rillio/components/ui/input';
import { useToast } from 'rillio/components/ui/use-toast';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { cn } from 'rillio/components/ui/cn';

export type SharePromptProps = {
    className?: string;
    url: string;
};

const SharePrompt = ({ className, url }: SharePromptProps) => {
    const { t } = useTranslation();
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const routeFocused = useRouteFocused();

    const selectInputContent = useCallback(() => {
        inputRef.current?.select();
    }, []);

    const copyToClipboard = useCallback(() => {
        inputRef.current?.select();
        navigator.clipboard.writeText(url)
            .then(() => {
                toast.show({ type: 'success', title: 'Copied to clipboard', timeout: 3000 });
            })
            .catch(() => {
                toast.show({ type: 'error', title: 'Could not copy to clipboard', timeout: 3000 });
            });
    }, [url, toast]);

    useEffect(() => {
        if (routeFocused) {
            inputRef.current?.select();
        }
    }, [routeFocused]);

    return (
        <div className={cn('flex flex-col gap-4', className)}>
            <div className="flex gap-3">
                <Button
                    className="h-11 flex-1 bg-[var(--color-facebook)] text-white hover:brightness-110"
                    title="Facebook"
                    href={`https://www.facebook.com/sharer/sharer.php?u=${url}`}
                    target="_blank"
                >
                    <Facebook className="size-5" />
                </Button>
                <Button
                    className="h-11 flex-1 bg-[var(--color-x)] text-white hover:brightness-110"
                    title="X (Twitter)"
                    href={`https://twitter.com/intent/tweet?text=${url}`}
                    target="_blank"
                >
                    <XSocial className="size-5" />
                </Button>
                <Button
                    className="h-11 flex-1 bg-[var(--color-reddit)] text-white hover:brightness-110"
                    title="Reddit"
                    href={`https://www.reddit.com/submit?url=${url}`}
                    target="_blank"
                >
                    <Reddit className="size-5" />
                </Button>
            </div>
            <div className="flex gap-2">
                <Input
                    ref={inputRef}
                    className="h-11 flex-1 rounded-full text-center"
                    type="text"
                    readOnly
                    defaultValue={url}
                    onClick={selectInputContent}
                    tabIndex={-1}
                />
                <Button className="h-11 gap-2 px-5" title={t('CTX_COPY_TO_CLIPBOARD')} onClick={copyToClipboard}>
                    <Link className="size-5" />
                    <span>{t('COPY')}</span>
                </Button>
            </div>
        </div>
    );
};

export default SharePrompt;
