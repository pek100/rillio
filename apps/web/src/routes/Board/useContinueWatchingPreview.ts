// Copyright (C) 2017-2023 Smart code 203358507

import { useModelState } from 'rillio/common';

// The continue_watching_preview model has no ambient type; it is consumed
// dynamically (as a MetaRow catalog) so the return stays `any`, matching the
// original untyped JS hook.
const useContinueWatchingPreview = (): any => {
    return useModelState({ model: 'continue_watching_preview', action: undefined });
};

export default useContinueWatchingPreview;
