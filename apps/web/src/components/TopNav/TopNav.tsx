import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import Logo from 'rillio/common/Logo/Logo';
import { cn } from 'rillio/common/cn';

// Reused legacy components (all the search + auth/account logic lives here).
const SearchBar = require('rillio/components/NavBar/HorizontalNavBar/SearchBar');
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

const ICON_BUTTON = 'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface/70 backdrop-blur transition-colors duration-150';

type Props = {
    className?: string;
    route?: string;
    query?: string;
};

const TopNav = ({ className, route, query }: Props) => {
    const { t } = useTranslation();
    const activeId = route === 'continue_watching' ? 'library' : route;
    const isSearchRoute = route === 'search';

    // The search field is collapsed to an icon and expands in place, so the
    // right-hand cluster stays a quiet row of icons. On the search route the
    // field is the point, so it stays open.
    const [searchOpen, setSearchOpen] = React.useState(isSearchRoute);
    const searchRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (isSearchRoute) {
            setSearchOpen(true);
        }
    }, [isSearchRoute]);

    React.useEffect(() => {
        if (!searchOpen) return;

        let frame = 0;
        let attempts = 0;
        const focusInput = () => {
            const input = searchRef.current?.querySelector('input');
            if (input instanceof HTMLInputElement) {
                input.focus();
                return;
            }
            // SearchBar is core-suspended, so its input can mount a frame or
            // two after the field expands.
            if (attempts++ < 30) {
                frame = requestAnimationFrame(focusInput);
            }
        };

        focusInput();
        return () => cancelAnimationFrame(frame);
    }, [searchOpen]);

    // Collapse on an outside click or Escape — but only while the field is
    // empty, so a typed query is never thrown away.
    React.useEffect(() => {
        if (!searchOpen || isSearchRoute) return;

        const isEmpty = () => {
            const input = searchRef.current?.querySelector('input');
            return !(input instanceof HTMLInputElement) || input.value.length === 0;
        };
        const onPointerDown = (event: MouseEvent) => {
            const element = searchRef.current;
            if (element && !element.contains(event.target as Node) && isEmpty()) {
                setSearchOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isEmpty()) {
                setSearchOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [searchOpen, isSearchRoute]);

    const openSearch = React.useCallback(() => setSearchOpen(true), []);

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
                {searchOpen ? (
                    <div ref={searchRef} className="w-60 shrink-0 lg:w-72">
                        {/* `active` renders a live input and stops the bar from
                            navigating on click — expanding must not change page. */}
                        <SearchBar className="w-full" query={query} active={true} />
                    </div>
                ) : (
                    <Button
                        onClick={openSearch}
                        title={t('SEARCH')}
                        className={cn(ICON_BUTTON, 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                    >
                        <Icon className="size-4" name="search" />
                    </Button>
                )}
                <Link
                    to="/addons"
                    title={t('ADDONS')}
                    tabIndex={-1}
                    className={cn(ICON_BUTTON, route === 'addons' ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                    <Icon className="size-4" name="addons-outline" />
                </Link>
                <NavMenu renderLabel={renderAccountLabel} />
            </div>
        </nav>
    );
};

export default TopNav;
