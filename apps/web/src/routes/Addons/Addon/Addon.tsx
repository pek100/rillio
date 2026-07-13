// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Addon card - clean-room rewrite as a flat divide-y list row (not a bordered
 * card), matching the Cached route idiom for this family. The whole row is a kit
 * Button (a div, so nesting interactive controls is valid) that opens the addon
 * details on click/Enter; the action controls stopPropagation and are tabIndex=-1
 * so the row owns keyboard focus. Icon-only controls use the canonical IconButton
 * (explicit square, never padding-sized - this is the configure-button geometry
 * fix). Every callback still emits the legacy {type,nativeEvent,reactEvent,dataset}
 * payload the route depends on.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button, IconButton } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui/cn';
import { Image } from 'rillio/components';

type BehaviorHints = {
    adult?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
    p2p?: boolean;
};

type ActionEvent = {
    type: string;
    nativeEvent: Event;
    reactEvent: React.MouseEvent;
    dataset?: unknown;
};

type Props = {
    id?: string;
    name?: string;
    version?: string;
    logo?: string;
    description?: string;
    types?: string[];
    behaviorHints: BehaviorHints;
    installed?: boolean;
    onInstall?: (event: ActionEvent) => void;
    onUninstall?: (event: ActionEvent) => void;
    onConfigure?: (event: ActionEvent) => void;
    onOpen?: (event: ActionEvent) => void;
    onShare?: (event: ActionEvent) => void;
    dataset?: unknown;
};

const emit = (
    handler: ((event: ActionEvent) => void) | undefined,
    type: string,
    event: React.MouseEvent,
    dataset: unknown,
) => {
    event.stopPropagation();
    if (typeof handler === 'function') {
        handler({ type, nativeEvent: event.nativeEvent, reactEvent: event, dataset });
    }
};

const Addon = ({
    id, name, version, logo, description, types, behaviorHints, installed,
    onInstall, onUninstall, onConfigure, onOpen, onShare, dataset,
}: Props) => {
    const { t } = useTranslation();

    const onOpenClick = useCallback((event: React.MouseEvent) => {
        emit(onOpen, 'open', event, dataset);
    }, [onOpen, dataset]);
    const onInstallClick = useCallback((event: React.MouseEvent) => {
        emit(onInstall, 'install', event, dataset);
    }, [onInstall, dataset]);
    const onUninstallClick = useCallback((event: React.MouseEvent) => {
        emit(onUninstall, 'uninstall', event, dataset);
    }, [onUninstall, dataset]);
    const onConfigureClick = useCallback((event: React.MouseEvent) => {
        emit(onConfigure, 'configure', event, dataset);
    }, [onConfigure, dataset]);
    const onShareClick = useCallback((event: React.MouseEvent) => {
        emit(onShare, 'share', event, dataset);
    }, [onShare, dataset]);

    const renderLogoFallback = useCallback(() => (
        <Icon name="addons" className="block size-full p-2.5 text-fg-muted" />
    ), []);

    const displayName = typeof name === 'string' && name.length > 0 ? name : id;
    const hasVersion = typeof version === 'string' && version.length > 0;
    const typesLabel = Array.isArray(types) && types.length > 0
        ? (types.length === 1 ? types.join('') : `${types.slice(0, -1).join(', ')} & ${types[types.length - 1]}`)
        : null;
    const showConfigure = !behaviorHints.configurationRequired && behaviorHints.configurable;
    const primaryLabel = installed
        ? t('ADDON_UNINSTALL')
        : behaviorHints.configurationRequired ? t('ADDON_CONFIGURE') : t('ADDON_INSTALL');
    const primaryOnClick = installed
        ? onUninstallClick
        : behaviorHints.configurationRequired ? onConfigureClick : onInstallClick;
    const primaryClassName = installed
        ? 'bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'
        : 'bg-accent-soft text-accent hover:bg-accent-soft hover:brightness-110';

    return (
        <Button
            variant="ghost"
            onClick={onOpenClick}
            className="group h-auto w-full items-start justify-start gap-4 whitespace-normal rounded-none px-6 py-5 text-left max-sm:flex-wrap"
        >
            <div className="size-14 shrink-0 overflow-hidden rounded-card bg-surface max-sm:mx-auto">
                <Image
                    className="block size-full object-contain p-1.5"
                    src={logo}
                    alt=" "
                    renderFallback={renderLogoFallback}
                />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-base font-semibold text-fg" title={displayName}>
                        {displayName}
                    </span>
                    {
                        hasVersion ?
                            <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                                {t('ADDON_VERSION_SHORT', { version })}
                            </span>
                            :
                            null
                    }
                </div>
                {
                    typesLabel !== null ?
                        <div className="mt-1 truncate text-xs capitalize text-fg-subtle">{typesLabel}</div>
                        :
                        null
                }
                {
                    typeof description === 'string' && description.length > 0 ?
                        <div className="mt-1 line-clamp-2 text-sm text-fg-muted" title={description}>{description}</div>
                        :
                        null
                }
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
                {
                    showConfigure ?
                        <IconButton title={t('ADDON_CONFIGURE')} tabIndex={-1} onClick={onConfigureClick}>
                            <Icon name="settings" className="size-4" />
                        </IconButton>
                        :
                        null
                }
                <Button
                    variant="ghost"
                    tabIndex={-1}
                    onClick={primaryOnClick}
                    title={primaryLabel}
                    className={cn('h-9 shrink-0 px-4 text-sm font-semibold max-sm:flex-1', primaryClassName)}
                >
                    {primaryLabel}
                </Button>
                <IconButton title={t('SHARE_ADDON')} tabIndex={-1} onClick={onShareClick}>
                    <Icon name="share" className="size-4" />
                </IconButton>
            </div>
        </Button>
    );
};

export default Addon;
