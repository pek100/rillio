// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useNavigate } = require('react-router');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('rillio/components');
const { default: Logo } = require('rillio/common/Logo/Logo');
const { useFullscreen } = require('rillio/common/Fullscreen');
const { useIsShell } = require('rillio/components/WindowControls/WindowControls');
const { useHorizontalNavGamepadNavigation } = require('rillio/services/GamepadNavigation');
const SearchBar = require('./SearchBar');
const NavMenu = require('./NavMenu');
const styles = require('./styles');
const { t } = require('i18next');

const HorizontalNavBar = React.memo(({ className, route, query, title, backButton, searchBar, fullscreenButton, navMenu, originPath, hdrInfo, ...props }) => {
    const navigate = useNavigate();
    const backButtonOnClick = React.useCallback(() => {
        if (originPath) {
            navigate(originPath, { replace: true });
        } else {
            navigate(-1);
        }
    }, [originPath, navigate]);
    const [fullscreen, requestFullscreen, exitFullscreen, , supported] = useFullscreen();
    // Frameless shell: this navbar (used by details/player/settings routes) is a
    // window drag handle, exactly like TopNav on the main routes. The attribute
    // only fires on the bar itself, so buttons/search stay clickable.
    const shell = useIsShell();
    const dragProps = shell ? { 'data-tauri-drag-region': '' } : {};
    const renderNavMenuLabel = React.useCallback(({ ref, className, onClick, children, }) => (
        <Button ref={ref} className={classnames(className, styles['button-container'], styles['menu-button-container'])} tabIndex={-1} onClick={onClick}>
            <Icon className={styles['icon']} name={'person-outline'} />
            {children}
        </Button>
    ), []);
    useHorizontalNavGamepadNavigation(route || className, backButton);
    return (
        <nav {...props} {...dragProps} className={classnames(className, styles['horizontal-nav-bar-container'])}>
            {
                backButton ?
                    <Button className={classnames(styles['button-container'], styles['back-button-container'])} tabIndex={-1} onClick={backButtonOnClick}>
                        <Icon className={styles['icon']} name={'chevron-back'} />
                    </Button>
                    :
                    <div className={styles['logo-container']}>
                        <Logo className="h-8 w-auto" />
                    </div>
            }
            {
                typeof title === 'string' && title.length > 0 ?
                    <h2 {...dragProps} className={styles['title']}>{title}</h2>
                    :
                    null
            }
            {
                searchBar && route !== 'addons' ?
                    <SearchBar className={styles['search-bar']} query={query} active={route === 'search'} />
                    :
                    null
            }
            <div className={styles['buttons-container']}>
                {
                    hdrInfo && (hdrInfo.gamma === 'pq' || hdrInfo.gamma === 'hlg') ?
                        <div className={styles['hdr-indicator']} title={hdrInfo.gamma === 'pq' ? 'HDR10' : 'HLG'}>
                            <Icon className={styles['icon']} name={'hdr'} />
                        </div>
                        :
                        null
                }
                {
                    navMenu ?
                        <NavMenu renderLabel={renderNavMenuLabel} />
                        :
                        null
                }
            </div>
        </nav>
    );
});

HorizontalNavBar.displayName = 'HorizontalNavBar';

HorizontalNavBar.propTypes = {
    className: PropTypes.string,
    route: PropTypes.string,
    query: PropTypes.string,
    title: PropTypes.string,
    backButton: PropTypes.bool,
    searchBar: PropTypes.bool,
    fullscreenButton: PropTypes.bool,
    navMenu: PropTypes.bool,
    originPath: PropTypes.string,
    hdrInfo: PropTypes.shape({
        gamma: PropTypes.string,
    }),
};

module.exports = HorizontalNavBar;
