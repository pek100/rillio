import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import Logo from 'rillio/common/Logo/Logo';
import { cn } from 'rillio/common/cn';
import SearchModal from 'rillio/components/SearchModal';

// Reused legacy components (all the auth/account logic lives here).
const NavMenu = require('rillio/components/NavBar/HorizontalNavBar/NavMenu');
const Button = require('rillio/components/Button').default;

type Tab = { id: string; label: string; href: string };

// Addons + Settings intentionally live in the Account hub (NavMenuContent), not here.
const TABS: Tab[] = [
    { id: 'board', label: 'Home', href: '/' },
    { id: 'discover', label: 'Discover', href: '/discover' },
    { id: 'library', label: 'Library', href: '/library' },
    { id: 'calendar', label: 'Calendar', href: '/calendar' },
];

// The keyboard shortcut lives in App; it asks us to open the palette.
export const OPEN_SEARCH_EVENT = 'rillio:open-search';

// Account keeps its island chip; search + addons are bare icons.
const ICON_BUTTON = 'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface/70 backdrop-blur transition-colors duration-150';
const ICON_BUTTON_BARE = 'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-150';

type Props = {
    className?: string;
    route?: string;
};

const TopNav = ({ className, route }: Props) => {
    const { t } = useTranslation();
    const activeId = route === 'continue_watching' ? 'library' : route;
    const [searchOpen, setSearchOpen] = React.useState(false);

    const openSearch = React.useCallback(() => setSearchOpen(true), []);
    const closeSearch = React.useCallback(() => setSearchOpen(false), []);

    React.useEffect(() => {
        window.addEventListener(OPEN_SEARCH_EVENT, openSearch);
        return () => window.removeEventListener(OPEN_SEARCH_EVENT, openSearch);
    }, [openSearch]);

    // Popup passes `className` (its `label-container` positioning context) + the
    // menu itself as `children`; both must be honored or the menu has no anchor
    // and renders clipped inside the button. Button renders a <div>, so it can
    // legally contain the menu's links (a native <button> cannot).
    const renderAccountLabel = React.useCallback(({ ref, className: labelClassName, onClick, children }: any) => (
        <Button
            ref={ref}
            onClick={onClick}
            title={t('Account')}
            className={cn(labelClassName, ICON_BUTTON, 'text-fg-muted hover:text-fg hover:bg-surface-hover')}
        >
            <Icon className="size-4" name="person-outline" />
            {children}
        </Button>
    ), [t]);

    return (
        <nav className={cn(className, 'flex items-center gap-5 h-full px-6 overflow-visible')}>
            <Link to="/" title="Rillio" tabIndex={-1} className="flex items-center gap-2.5 shrink-0">
                <Logo className="h-8 w-auto" />
                <span className="hidden text-lg font-semibold tracking-tight text-fg sm:block">Rillio</span>
            </Link>

            <div className="flex items-center gap-1 shrink-0">
                {TABS.map((tab) => {
                    const selected = tab.id === activeId;
                    return (
                        <Link
                            key={tab.id}
                            to={tab.href}
                            tabIndex={-1}
                            className={cn(
                                'inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors duration-150',
                                selected ? 'text-accent' : 'text-fg-muted hover:text-fg'
                            )}
                        >
                            {t(tab.label)}
                        </Link>
                    );
                })}
            </div>

            <div className="flex-1" />

            <div className="flex shrink-0 items-center gap-2 overflow-visible">
                <Button
                    onClick={openSearch}
                    title={t('SEARCH')}
                    className={cn(ICON_BUTTON_BARE, 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="search" />
                </Button>
                <Link
                    to="/addons"
                    title={t('ADDONS')}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON_BARE, route === 'addons' ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="addons-outline" />
                </Link>
                <NavMenu renderLabel={renderAccountLabel} />
            </div>

            {searchOpen ? <SearchModal onClose={closeSearch} /> : null}
        </nav>
    );
};

export default TopNav;
