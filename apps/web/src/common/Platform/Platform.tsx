import React, { createContext, useContext } from 'react';
import { WHITELISTED_HOSTS } from 'rillio/common/CONSTANTS';
import { name, isMobile } from './device';
import useShell from './shell/useShell';

interface PlatformContext {
    name: string;
    isMobile: boolean;
    shell: Shell;
    openExternal: (url: string) => void;
}

const PlatformContext = createContext<PlatformContext>({} as PlatformContext);

type Props = {
    children: JSX.Element;
};

const PlatformProvider = ({ children }: Props) => {
    const shell = useShell();

    const openExternal = (url: string) => {
        // Desktop shell (Tauri): open natively in the OS default handler /
        // external player. The browser safety-warning wrapper below is a
        // web-only guard; in the trusted shell we hand the URL straight to the OS.
        const tauri = (globalThis as any).__TAURI__;
        if (tauri?.core?.invoke) {
            tauri.core.invoke('open_external', { url })
                .catch((e: unknown) => console.error('Shell openExternal failed:', e));
            return;
        }

        try {
            const { hostname } = new URL(url);
            const isWhitelisted = WHITELISTED_HOSTS.some((host: string) =>
                hostname === host || hostname.endsWith('.' + host)
            );
            const finalUrl = !isWhitelisted ? `https://www.stremio.com/warning#${encodeURIComponent(url)}` : url;

            window.open(finalUrl, '_blank');
        } catch (e) {
            console.error('Failed to parse external url:', e);
        }
    };

    return (
        <PlatformContext.Provider value={{ openExternal, shell, name, isMobile }}>
            {children}
        </PlatformContext.Provider>
    );
};

const usePlatform = () => {
    return useContext(PlatformContext);
};

export {
    PlatformProvider,
    usePlatform
};
