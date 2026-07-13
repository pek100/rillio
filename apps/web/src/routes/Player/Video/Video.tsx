// Copyright (C) 2017-2023 Smart code 203358507

import React, { forwardRef } from 'react';

// Was routes/Player/Video/styles.less: the container is a bare passthrough; the
// inner div is the mpv playback surface (fills the container; its descendants
// inherit font-size). Ported to Tailwind on this component's own markup only - no
// logic, ref wiring or packages/video touched.

type Props = {
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
};

const Video = forwardRef<HTMLDivElement, Props>(function Video({ className, onClick, onDoubleClick }, ref) {
    return (
        <div className={className} onClick={onClick} onDoubleClick={onDoubleClick}>
            <div ref={ref} className={'w-full h-full [&_*]:[font-size:inherit]'} />
        </div>
    );
});

Video.displayName = 'Video';

export default Video;
