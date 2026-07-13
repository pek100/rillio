// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Narrow-layout gate for the day-detail Drawer. Mirrors the exact breakpoints the old
 * BottomSheet.less used to reveal the sheet (and the List pane used to hide): shown in
 * portrait below 1300px, or in landscape below 1000px. On wider layouts the right-hand
 * List pane shows the day detail inline, so the Drawer must stay closed.
 */

import { useEffect, useState } from 'react';

const QUERY = '(orientation: portrait) and (max-width: 1299px), (orientation: landscape) and (max-width: 999px)';

const useIsNarrow = (): boolean => {
    const [narrow, setNarrow] = useState<boolean>(() => window.matchMedia(QUERY).matches);

    useEffect(() => {
        const mql = window.matchMedia(QUERY);
        const onChange = () => setNarrow(mql.matches);
        onChange();
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return narrow;
};

export default useIsNarrow;
