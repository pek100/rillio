import React, { useCallback, useMemo } from 'react';
import { useCore } from 'rillio/core';
import { useDisplayName } from 'rillio/common/useDisplayName';
import { openSync } from 'rillio/common/syncEvents';
import DisplayNameEdit from 'rillio/components/DisplayNameEdit';
import { Link } from '../../components';

type Props = {
    profile: Profile,
};

const User = ({ profile }: Props) => {
    const core = useCore();
    const [displayName, setDisplayName] = useDisplayName();

    // The identity is the LOCAL profile, always: a connected Stremio account is
    // an attached sync service, not who you are. Same avatar either way.
    const avatar = useMemo(() => `url('${require('/assets/images/avatar-anonymous.svg')}')`, []);

    // Disconnect, never Logout: the session ends but every local bucket stays
    // (core Ctx.Disconnect). The bucket-wiping Logout is not reachable from UI.
    const onDisconnect = useCallback(() => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'Disconnect'
            }
        });
    }, []);

    return (
        <div className="flex w-full flex-row items-center gap-4 max-[640px]:flex-col max-[640px]:items-start">
            <div
                className="mr-4 size-20 flex-none rounded-full border-2 border-line bg-fg bg-cover bg-center bg-no-repeat opacity-90 [background-clip:content-box] [background-origin:content-box]"
                style={{ backgroundImage: avatar }}
            />
            <div className="flex flex-none flex-col items-start">
                <DisplayNameEdit
                    className="min-h-[1.9rem] [--display-name-icon-size:1rem] [--display-name-max-width:18rem] [--display-name-size:1.4rem]"
                    value={displayName}
                    onCommit={setDisplayName}
                />
                <div className="text-[0.95rem] text-fg opacity-50" title={profile.auth === null ? 'Local profile' : `Syncing via ${profile.auth.user.email}`}>
                    {profile.auth === null ? 'Local profile' : `Local profile - syncing via ${profile.auth.user.email}`}
                </div>
                {/* Sync & backup / Stremio sync moved to the account dropdown (the
                    NavMenu) - account-shaped actions live with the account. Only the
                    connection state remains here. */}
                <div className="mt-2 flex flex-row flex-wrap gap-4">
                    {
                        profile.auth !== null ?
                            <Link label={'Disconnect'} onClick={onDisconnect} />
                            :
                            <Link label={'Connect Stremio account'} onClick={() => openSync('stremio')} />
                    }
                </div>
            </div>
        </div>
    );
};

export default User;
