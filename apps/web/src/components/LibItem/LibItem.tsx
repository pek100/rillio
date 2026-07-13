// Copyright (C) 2017-2025 Smart code 203358507

/**
 * LibItem - a library / continue-watching poster card. A thin behavioral wrapper
 * around the kit-based MetaItem: it derives the new-videos badge count and the
 * context-menu `options`, then routes `optionOnSelect` and `onPlayClick` through
 * the core transport / router.
 *
 * The selectPrevented protocol is untouched: MetaItem sets the flag on the inner
 * controls, and this optionOnSelect first forwards to a parent handler that may set
 * `event.nativeEvent.optionSelectPrevented`, only acting on the option when the
 * parent did not veto it.
 */

import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCore } from 'rillio/core';
import MetaItem from 'rillio/components/MetaItem';
const { default: toPath } = require('rillio-router/toPath');

type DeepLinks = {
    metaDetailsVideos?: string;
    metaDetailsStreams?: string;
    player?: string;
};

type OptionSelectEvent = {
    value: string;
    nativeEvent: Event & { optionSelectPrevented?: boolean };
};

type Props = {
    _id?: string;
    removable?: boolean;
    progress?: number;
    notifications?: { items?: Record<string, unknown[]> };
    watched?: boolean;
    deepLinks?: DeepLinks;
    optionOnSelect?: (event: OptionSelectEvent) => void;
    [key: string]: unknown;
};

const LibItem = ({ _id, removable, notifications, watched, ...props }: Props) => {
    const navigate = useNavigate();
    const core = useCore();
    const { t } = useTranslation();

    const deepLinks = props.deepLinks as DeepLinks | undefined;
    const progress = props.progress as number | undefined;

    const newVideos = useMemo(() => {
        const count = notifications?.items?.[_id as string]?.length ?? 0;
        return Math.min(Math.max(count, 0), 99);
    }, [_id, notifications]);

    const options = useMemo(() => {
        return [
            { label: 'LIBRARY_PLAY', value: 'play' },
            { label: 'LIBRARY_DETAILS', value: 'details' },
            { label: 'LIBRARY_RESUME_DISMISS', value: 'dismiss' },
            { label: watched ? 'CTX_MARK_UNWATCHED' : 'CTX_MARK_WATCHED', value: 'watched' },
            { label: 'LIBRARY_REMOVE', value: 'remove' },
        ].filter(({ value }) => {
            switch (value) {
                case 'play':
                    return deepLinks && typeof deepLinks.player === 'string';
                case 'details':
                    return deepLinks && (typeof deepLinks.metaDetailsVideos === 'string' || typeof deepLinks.metaDetailsStreams === 'string');
                case 'watched':
                    return typeof watched !== 'undefined' && deepLinks && (typeof deepLinks.metaDetailsVideos === 'string' || typeof deepLinks.metaDetailsStreams === 'string');
                case 'dismiss':
                    return typeof _id === 'string' && progress !== null && !isNaN(progress as number) && (progress as number) > 0;
                case 'remove':
                    return typeof _id === 'string' && removable;
            }
        }).map((option) => ({
            ...option,
            label: t(option.label)
        }));
    }, [_id, removable, progress, deepLinks, watched, t]);

    const optionOnSelect = useCallback((event: OptionSelectEvent) => {
        if (typeof props.optionOnSelect === 'function') {
            props.optionOnSelect(event);
        }

        if (!event.nativeEvent.optionSelectPrevented) {
            switch (event.value) {
                case 'play': {
                    if (deepLinks && typeof deepLinks.player === 'string') {
                        navigate(toPath(deepLinks.player));
                    }

                    break;
                }
                case 'details': {
                    if (deepLinks) {
                        if (typeof deepLinks.metaDetailsVideos === 'string') {
                            navigate(toPath(deepLinks.metaDetailsVideos));
                        } else if (typeof deepLinks.metaDetailsStreams === 'string') {
                            navigate(toPath(deepLinks.metaDetailsStreams));
                        }
                    }

                    break;
                }
                case 'watched': {
                    if (typeof _id === 'string') {
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'LibraryItemMarkAsWatched',
                                args: {
                                    id: _id,
                                    is_watched: !watched
                                }
                            }
                        });
                    }

                    break;
                }
                case 'dismiss': {
                    if (typeof _id === 'string') {
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'RewindLibraryItem',
                                args: _id
                            }
                        });
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'DismissNotificationItem',
                                args: _id
                            }
                        });
                    }

                    break;
                }
                case 'remove': {
                    if (typeof _id === 'string') {
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'RemoveFromLibrary',
                                args: _id
                            }
                        });
                    }

                    break;
                }
            }
        }
    }, [_id, deepLinks, watched, core, navigate, props.optionOnSelect]);

    const onPlayClick = useMemo(() => {
        if (deepLinks && typeof deepLinks.player === 'string') {
            return (event: React.MouseEvent) => {
                event.preventDefault();
                navigate(toPath(deepLinks.player));
            };
        }
        return null;
    }, [deepLinks, navigate]);

    return (
        <MetaItem
            {...props}
            watched={watched}
            newVideos={newVideos}
            options={options}
            optionOnSelect={optionOnSelect}
            onPlayClick={onPlayClick}
        />
    );
};

export default LibItem;
