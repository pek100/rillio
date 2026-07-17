// Copyright (C) 2017-2025 Smart code 203358507

import React from 'react';
import routes from 'rillio/routes';

type RouterPathDef = {
    path: string,
    view: number,
    element: React.ReactNode,
};

const routerPaths: RouterPathDef[] = [
    // No /intro route: the app is local-first with no signup surface; connecting
    // a Stremio account (a sync service) lives in the Sync modal.
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
        path: '/player/:stream/:streamTransportUrl?/:metaTransportUrl?/:type?/:id?/:videoId?',
        view: 4,
        element: <routes.Player />,
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
