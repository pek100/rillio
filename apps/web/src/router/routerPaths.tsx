// Copyright (C) 2017-2025 Smart code 203358507

import React from 'react';
import routes from 'rillio/routes';
import SearchModal, { SEARCH_MODAL_PATH } from 'rillio/components/SearchModal';

type RouterPathDef = {
    path: string,
    view: number,
    element: React.ReactNode,
    // A modal route floats over the view beneath it, which stays visible.
    modal?: boolean,
};

const routerPaths: RouterPathDef[] = [
    {
        path: '/intro',
        view: 1,
        element: <routes.Intro />,
    },
    {
        path: '/discover/:transportUrl?/:type?/:catalogId?',
        view: 1,
        element: <routes.Discover />,
    },
    {
        path: '/library/:type?',
        view: 1,
        element: <routes.Library />,
    },
    {
        path: '/calendar/:year?/:month?',
        view: 1,
        element: <routes.Calendar />,
    },
    {
        path: '/continuewatching/:type?',
        view: 1,
        element: <routes.Library />,
    },
    {
        path: '/search',
        view: 1,
        element: <routes.Search />,
    },
    {
        path: '/metadetails/:type?/:id?/:videoId?',
        view: 2,
        element: <routes.MetaDetails />,
    },
    {
        path: '/detail/:type?/:id?/:videoId?',
        view: 2,
        element: <routes.MetaDetails />,
    },
    {
        path: '/addons/:type?/:transportUrl?/:catalogId?',
        view: 3,
        modal: true,
        element: <routes.Addons />,
    },
    {
        path: '/settings',
        view: 3,
        modal: true,
        element: <routes.Settings />,
    },
    {
        path: '/cached',
        view: 3,
        modal: true,
        element: <routes.Cached />,
    },
    {
        path: '/player/:stream/:streamTransportUrl?/:metaTransportUrl?/:type?/:id?/:videoId?',
        view: 4,
        element: <routes.Player />,
    },
    {
        // The search palette: a modal route floating over the current view, given
        // the highest view number so it overlays any route (incl. Player) without
        // clearing it. It renders its own portal + blurred backdrop.
        path: SEARCH_MODAL_PATH,
        view: 5,
        modal: true,
        element: <SearchModal />,
    },
    {
        path: '/',
        view: 0,
        element: <routes.Board />,
    },
    {
        path: '*',
        view: 1,
        element: <routes.NotFound />,
    },
];

export default routerPaths;
