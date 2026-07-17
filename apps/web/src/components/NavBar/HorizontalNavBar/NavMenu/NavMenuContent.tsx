// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Account hub panel (contents of the NavMenu popover): who you are, the other
 * local profiles, and this device's sync doors.
 *
 * THE ACCOUNT IS LOCAL. The identity shown here is always the local profile
 * (display name + local avatar); a connected Stremio account is an ATTACHED
 * SYNC SERVICE, never the identity - data lives on this device either way,
 * Stremio only keeps it in sync across devices (Michael's directive).
 *
 * Sections, top to bottom:
 *   Identity - the local profile: avatar + editable display name.
 *   Profiles - the offline (local) profiles on this device: switch (writes the
 *     active pointer + reloads so the core boots from the new namespace),
 *     create, and delete (two-step inline confirm; default + active protected).
 *     See common/profileStorage.
 *   Sync - "Sync & backup" and "Stremio sync" open the Sync modal on their
 *     tabs; when connected, the Stremio row carries the service line (email +
 *     Disconnect - Ctx.Disconnect: session ends, ALL local data stays, never
 *     the bucket-wiping Logout).
 *   Fullscreen - browser only (the shell's window header owns real fullscreen).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Minimize, Maximize, RefreshCw, Archive, Plus, Check, X, Unplug } from 'lucide-react';
import { useCore } from 'rillio/core';
import { useFullscreen } from 'rillio/common/Fullscreen';
import { withCoreSuspender } from 'rillio/common/CoreSuspender';
import { useDisplayName, randomDisplayName } from 'rillio/common/useDisplayName';
import { openSync } from 'rillio/common/syncEvents';
import {
    listProfiles, activeProfileId, createProfile, switchProfile, deleteProfile,
    getItemForProfile, setItemForProfile, DEFAULT_PROFILE_ID, type ProfileEntry,
} from 'rillio/common/profileStorage';
import { Button } from 'rillio/components/ui/button';
import { cn } from 'rillio/components/ui';
import DisplayNameEdit from 'rillio/components/DisplayNameEdit';
import { useIsShell } from 'rillio/components/WindowControls/WindowControls';

const useProfile = require('rillio/common/useProfile');
const usePWA = require('rillio/common/usePWA');
const avatarAnonymous = require('/assets/images/avatar-anonymous.svg');

const NAME_KEY = 'rillio.displayName';

const ROW = 'flex h-11 w-full items-center gap-3 rounded-none px-5 text-sm font-normal text-fg transition-colors duration-150 hover:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle hover:[&_svg]:text-fg';

type Props = {
    onSelect?: () => void,
};

const NavMenuContent = ({ onSelect }: Props) => {
    const { t } = useTranslation();
    const core = useCore();
    const profile = useProfile();
    const [displayName, setDisplayName] = useDisplayName();
    const [fullscreen, requestFullscreen, exitFullscreen, , supported] = useFullscreen();
    const [, isAndroidPWA] = usePWA();
    // In the desktop shell the window header owns (native) fullscreen; this
    // browser-API entry would only fullscreen the webview inside the frame.
    const inShell = useIsShell();

    const [profiles, setProfiles] = React.useState<ProfileEntry[]>(listProfiles);
    // Two-step delete: the first click arms this id, the second deletes.
    const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
    const activeId = activeProfileId();

    // Disconnect keeps everything local; only the Stremio session ends.
    const disconnect = React.useCallback(() => {
        core.transport.dispatch({ action: 'Ctx', args: { action: 'Disconnect' } });
    }, [core]);

    const onCreateProfile = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        const entry = createProfile();
        // Give the new profile a name up front so the picker never shows an
        // anonymous blank before its first activation.
        setItemForProfile(entry.id, NAME_KEY, randomDisplayName());
        setProfiles(listProfiles());
    }, []);

    const onSwitchProfile = React.useCallback((id: string) => {
        if (id === activeId) return;
        switchProfile(id);
        // Full reload: the core must boot from the new profile's namespace;
        // nothing in-memory may survive the switch.
        window.location.reload();
    }, [activeId]);

    const onDeleteProfile = React.useCallback((event: React.MouseEvent, id: string) => {
        event.stopPropagation();
        if (confirmDeleteId !== id) {
            setConfirmDeleteId(id);
            return;
        }
        deleteProfile(id);
        setConfirmDeleteId(null);
        setProfiles(listProfiles());
    }, [confirmDeleteId]);

    const profileName = (id: string): string =>
        (id === activeId ? displayName : getItemForProfile(id, NAME_KEY)) || 'Unnamed profile';

    return (
        <div className="max-h-[calc(100vh-6rem)] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto">
            {/* The LOCAL identity - never the Stremio account's avatar/email:
                the account is this device's profile, Stremio is only a sync
                service attached below. */}
            <div className="flex items-center gap-4 p-6">
                <div
                    className="size-10 shrink-0 rounded-full bg-cover bg-center bg-no-repeat opacity-90"
                    style={{ backgroundImage: `url('${avatarAnonymous}')`, backgroundColor: 'var(--color-fg)' }}
                />
                <div className="flex min-w-0 flex-auto flex-col justify-center">
                    <DisplayNameEdit className="min-h-[1.6rem]" value={displayName} onCommit={setDisplayName} />
                    <div className="mt-1 text-[0.85rem] text-fg-subtle">Local profile - all data stays on this device</div>
                </div>
            </div>

            {/* Offline (local) profiles on this device. */}
            <div className="border-t border-line py-1">
                <div className="px-5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Profiles</div>
                {profiles.map((entry) => (
                    <div key={entry.id} className="group/profile relative">
                        <Button
                            variant="ghost"
                            className={ROW}
                            title={entry.id === activeId ? 'This profile is active' : `Switch to ${profileName(entry.id)}`}
                            onClick={() => onSwitchProfile(entry.id)}
                        >
                            {entry.id === activeId ? <Check className="!text-accent" /> : <span className="size-4 shrink-0" />}
                            <span className="min-w-0 flex-1 truncate text-left">{profileName(entry.id)}</span>
                        </Button>
                        {
                            entry.id !== activeId && entry.id !== DEFAULT_PROFILE_ID ?
                                <Button
                                    variant="ghost"
                                    className="absolute right-3 top-1/2 h-7 -translate-y-1/2 rounded-full px-2 text-[0.78rem] text-fg-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-danger group-hover/profile:opacity-100"
                                    title={confirmDeleteId === entry.id ? 'Click again to permanently delete this profile and its data' : 'Delete this profile'}
                                    onClick={(event) => onDeleteProfile(event, entry.id)}
                                >
                                    {confirmDeleteId === entry.id ? 'Delete?' : <X className="size-3.5" />}
                                </Button>
                                : null
                        }
                    </div>
                ))}
                <Button variant="ghost" className={ROW} title="Create a new empty profile" onClick={onCreateProfile}>
                    <Plus />
                    <span className="flex-1 text-left">New profile</span>
                </Button>
            </div>

            {/* Sync doors: both open the Sync modal (App/SyncModal) on a tab.
                A connected Stremio account renders as the attached SERVICE it
                is: a status line under the row, plus Disconnect right here. */}
            <div className="border-t border-line py-1">
                <Button variant="ghost" className={ROW} title="Back up this profile or restore one from a code" onClick={() => { openSync('backup'); onSelect?.(); }}>
                    <Archive />
                    <span className="flex-1 text-left">Sync &amp; backup</span>
                </Button>
                <Button
                    variant="ghost"
                    className={cn(ROW, profile.auth !== null && 'h-auto py-2')}
                    title={profile.auth !== null ? 'View sync status and differences' : 'Use a Stremio account as a sync service'}
                    onClick={() => { openSync('stremio'); onSelect?.(); }}
                >
                    <RefreshCw />
                    <span className="flex min-w-0 flex-1 flex-col text-left">
                        <span>Stremio sync</span>
                        {
                            profile.auth !== null ?
                                <span className="mt-0.5 truncate text-[0.78rem] font-normal text-fg-subtle">Syncing via {profile.auth.user.email}</span>
                                : null
                        }
                    </span>
                </Button>
                {
                    profile.auth !== null ?
                        <Button
                            variant="ghost"
                            className={ROW}
                            title="Disconnect from Stremio - everything synced stays saved on this device"
                            onClick={disconnect}
                        >
                            <Unplug />
                            <span className="flex-1 text-left">Disconnect</span>
                        </Button>
                        : null
                }
            </div>

            {
                supported && !isAndroidPWA && !inShell ?
                    <div className="border-t border-line py-1" onClick={onSelect}>
                        <Button variant="ghost" className={ROW} title={fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')} onClick={fullscreen ? exitFullscreen : requestFullscreen}>
                            {fullscreen ? <Minimize /> : <Maximize />}
                            <span className="flex-1 text-left">{fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')}</span>
                        </Button>
                    </div>
                    :
                    null
            }

        </div>
    );
};

const NavMenuContentFallback = () => (
    <div className="w-[22rem] max-w-[calc(100vw-1rem)]" />
);

export default withCoreSuspender(NavMenuContent, NavMenuContentFallback);
