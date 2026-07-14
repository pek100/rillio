import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCore } from 'rillio/core';
import { useDisplayName } from 'rillio/common/useDisplayName';
import { openSync } from 'rillio/common/syncEvents';
import DisplayNameEdit from 'rillio/components/DisplayNameEdit';
import { Link } from '../../components';

type Props = {
    profile: Profile,
};

const User = ({ profile }: Props) => {
    const { t } = useTranslation();
    const core = useCore();
    const [displayName, setDisplayName] = useDisplayName();

    const avatar = useMemo(() => (
        !profile.auth ?
            `url('${require('/assets/images/avatar-anonymous.svg')}')`
            :
            profile.auth.user.avatar ?
                `url('${profile.auth.user.avatar}')`
                :
                `url('${require('/assets/images/avatar-default.svg')}')`
    ), [profile.auth]);

    const onLogout = useCallback(() => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'Logout'
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
                <div className="text-[0.95rem] text-fg opacity-50" title={profile.auth === null ? t('ANONYMOUS_USER') : profile.auth.user.email}>
                    {profile.auth === null ? t('ANONYMOUS_USER') : profile.auth.user.email}
                </div>
                {/* No "Upload to Stremio" row: Import and Upload are one Stremio tab
                    now (sign in once, pick a direction), so a third link would open the
                    same place Import does. It was also broken - it asked for a tab that
                    no longer exists and silently landed on Backup & restore. */}
                <div className="mt-2 flex flex-row flex-wrap gap-4">
                    <Link label={'Sync & backup'} onClick={() => openSync('backup')} />
                    <Link label={'Import from Stremio'} onClick={() => openSync('stremio')} />
                    {
                        profile.auth !== null ?
                            <Link label={t('LOG_OUT')} onClick={onLogout} />
                            :
                            null
                    }
                </div>
            </div>
        </div>
    );
};

export default User;
