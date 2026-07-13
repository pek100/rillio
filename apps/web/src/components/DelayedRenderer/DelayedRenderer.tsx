// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Delay-gate: renders {children} only after {delay} ms (cleared on unmount). Used to
 * defer secondary content and avoid flashing loaders. Clean-room TS rewrite of the
 * legacy CommonJS component; the API ({ delay, children }) is unchanged.
 */

import React from 'react';

type Props = {
    children?: React.ReactNode,
    delay?: number,
};

const DelayedRenderer = ({ children, delay }: Props) => {
    const [render, setRender] = React.useState(false);

    React.useEffect(() => {
        const timeout = setTimeout(() => setRender(true), delay);
        return () => clearTimeout(timeout);
    }, []);

    return render ? <>{children}</> : null;
};

export default DelayedRenderer;
