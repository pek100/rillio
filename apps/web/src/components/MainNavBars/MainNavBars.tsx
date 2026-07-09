// Copyright (C) 2017-2023 Smart code 203358507

import React, { memo } from 'react';
import classnames from 'classnames';
import TopNav from 'rillio/components/TopNav/TopNav';
import { useContentGamepadNavigation } from 'rillio/services/GamepadNavigation';
import styles from './MainNavBars.less';

type Props = {
    className: string,
    route?: string,
    query?: string,
    children?: React.ReactNode,
};

const MainNavBars = memo(({ className, route, query, children }: Props) => {
    const contentRef = React.useRef(null);

    const navRoute = route === 'continue_watching' ? 'library' : (route ?? '');
    useContentGamepadNavigation(contentRef, navRoute);

    return (
        <div className={classnames(className, styles['main-nav-bars-container'])}>
            <TopNav
                className={styles['horizontal-nav-bar']}
                route={route}
                query={query}
            />
            <div ref={contentRef} className={styles['nav-content-container']}>{children}</div>
        </div>
    );
});

export default MainNavBars;

