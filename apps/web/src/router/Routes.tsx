// Copyright (C) 2017-2025 Smart code 203358507

import React from 'react';
import { Routes as RRoutes, Route as RRoute, useLocation, matchPath } from 'react-router';
import type { Location } from 'react-router';
import routerPaths from './routerPaths';
import Route from './Route';

type RouterPath = typeof routerPaths[number];
type CachedView = {
    key: string,
    location: Location,
    route: RouterPath,
};

const VIEW_COUNT = Math.max(...routerPaths.map((route) => route.view)) + 1;

const getRouteForLocation = (location: Location) => {
    return routerPaths.find((route) => matchPath({ path: route.path, end: true }, location.pathname));
};

const getNextViews = (currentViews: (CachedView | null)[], location: Location) => {
    const route = getRouteForLocation(location);
    if (!route) {
        return currentViews;
    }

    return Array.from({ length: VIEW_COUNT }, (_, index) => {
        if (index < route.view) {
            return currentViews[index] || null;
        }

        if (index === route.view) {
            return {
                key: `${route.view}:${route.path}`,
                location,
                route,
            };
        }

        return null;
    });
};

const Routes = () => {
    const location = useLocation();
    const [views, setViews] = React.useState<(CachedView | null)[]>(() => getNextViews([], location));
    // (No auth-driven redirects: the /intro signup surface is gone - the app is
    // local-first, and connecting Stremio as a sync service lives in the Sync
    // modal, which never navigates.)

    React.useLayoutEffect(() => {
        setViews((currentViews) => getNextViews(currentViews, location));
    }, [location]);

    const visibleViews = views.filter((view): view is CachedView => view !== null);

    return (
        <div className="routes-container">
            {
                visibleViews.map((view, index) => (
                    <RRoutes key={view.key} location={view.location}>
                        <RRoute
                            path={view.route.path}
                            element={<Route component={view.route.element} focused={index === visibleViews.length - 1} />}
                        />
                    </RRoutes>
                ))
            }
        </div>
    );
};

export default Routes;
