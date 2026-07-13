// Copyright (C) 2017-2023 Smart code 203358507

/**
 * MetaDetails route shell (Phase 3 clean-room rewrite).
 *
 * View layer rebuilt on Tailwind semantic tokens; every hook / core.transport
 * dispatch is reused verbatim (useMetaDetails / useSeason / useMetaExtensionTabs,
 * AddToLibrary / RemoveFromLibrary / MarkAsWatched / ToggleLibraryItemNotifications,
 * useContentGamepadNavigation, useNavigateWithOrigin). Layout mirrors the old
 * styles.less: a fixed backdrop image layer with a gradient scrim, a HorizontalNavBar,
 * an optional VerticalNavBar for meta-extension tabs, and a single scrolling
 * main-column holding the 50vh [details | hero] band then the full-width
 * StreamsList / VideosList. The meta-extension addon opens in the shared ModalDialog.
 */

import React from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCore } from 'rillio/core';
import { useContentGamepadNavigation } from 'rillio/services/GamepadNavigation';
import { withCoreSuspender } from 'rillio/common';
import { useNavigateWithOrigin } from 'rillio-router';
import { VerticalNavBar, HorizontalNavBar, DelayedRenderer, Image, MetaPreview, ModalDialog } from 'rillio/components';
import { cn } from 'rillio/components/ui/cn';
import StreamsList from './StreamsList';
import VideosList from './VideosList';
import HeroMedia from './HeroMedia';
import useMetaDetails from './useMetaDetails';
import useSeason from './useSeason';
import useMetaExtensionTabs from './useMetaExtensionTabs';

const GAMEPAD_HANDLER_ID = 'metadetails';

const emptyImage = require('/assets/images/empty.svg');

// The meta-details message states (no meta selected / no addons / not found) all
// share this centered empty-illustration block.
const MetaMessage = ({ label }: { label: string }) => (
    <div className="flex flex-1 flex-col items-center justify-center self-stretch px-8 py-16">
        <Image className="mb-4 h-48 w-48 max-w-full flex-none object-contain object-center opacity-90" src={emptyImage} alt={' '} />
        <div className="flex-none self-stretch text-center text-[2rem] text-fg">{label}</div>
    </div>
);

const MetaDetails = () => {
    const { type, id, videoId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { getStoredOrigin } = useNavigateWithOrigin();
    const contentRef = React.useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const core = useCore();
    const urlParams = React.useMemo(() => ({
        type,
        id,
        videoId
    }), [type, id, videoId]);
    const metaDetails = useMetaDetails(urlParams);
    const [season, setSeason] = useSeason(urlParams);
    const [tabs, metaExtension, clearMetaExtension] = useMetaExtensionTabs(metaDetails.metaExtensions);
    const [metaPath, streamPath] = React.useMemo(() => {
        return metaDetails.selected !== null ?
            [metaDetails.selected.metaPath, metaDetails.selected.streamPath]
            :
            [null, null];
    }, [metaDetails.selected]);
    const video = React.useMemo(() => {
        return streamPath !== null && metaDetails.metaItem !== null && metaDetails.metaItem.content.type === 'Ready' ?
            metaDetails.metaItem.content.content.videos.reduce((result, video) => {
                if (video.id === streamPath.id) {
                    return video;
                }

                return result;
            }, null)
            :
            null;
    }, [metaDetails.metaItem, streamPath]);
    const addToLibrary = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'AddToLibrary',
                args: metaDetails.metaItem.content.content
            }
        });
    }, [metaDetails]);
    const removeFromLibrary = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'RemoveFromLibrary',
                args: metaDetails.metaItem.content.content.id
            }
        });
    }, [metaDetails]);
    const toggleWatched = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkAsWatched',
                args: !metaDetails.metaItem.content.content.watched
            }
        });
    }, [metaDetails]);
    const toggleNotifications = React.useCallback(() => {
        if (metaDetails.libraryItem) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'ToggleLibraryItemNotifications',
                    args: [metaDetails.libraryItem._id, !metaDetails.libraryItem.state.noNotif],
                }
            });
        }
    }, [metaDetails.libraryItem]);
    const seasonOnSelect = React.useCallback((event) => {
        setSeason(event.value);
    }, [setSeason]);
    const handleEpisodeSearch = React.useCallback((season, episode) => {
        const searchVideoHash = encodeURIComponent(`${urlParams.id}:${season}:${episode}`);
        const url = location.pathname;
        const searchVideoPath = (urlParams.videoId === undefined || urlParams.videoId === null || urlParams.videoId === '') ?
            url + (!url.endsWith('/') ? '/' : '') + searchVideoHash
            : url.replace(encodeURIComponent(urlParams.videoId), searchVideoHash);
        navigate(searchVideoPath, { replace: true });
    }, [urlParams, location]);

    const renderBackgroundImageFallback = React.useCallback(() => null, []);
    const renderBackground = React.useMemo(() => !!(
        metaPath &&
        metaDetails?.metaItem &&
        metaDetails.metaItem.content.type !== 'Loading' &&
        typeof metaDetails.metaItem.content.content?.background === 'string' &&
        metaDetails.metaItem.content.content.background.length > 0
    ), [metaPath, metaDetails]);
    const originPath = React.useMemo(() => getStoredOrigin(), [getStoredOrigin]);
    const trailerYtIds = React.useMemo(() => {
        const ts = metaDetails.metaItem?.content?.content?.trailerStreams;
        return Array.isArray(ts) ?
            ts.map((t) => t.ytId).filter((id) => typeof id === 'string' && id.length > 0)
            :
            [];
    }, [metaDetails.metaItem]);

    useContentGamepadNavigation(contentRef, GAMEPAD_HANDLER_ID);
    return (
        <div
            className="relative box-border flex h-full w-full flex-col"
            style={{ paddingLeft: 'var(--safe-area-inset-left)', paddingRight: 'var(--safe-area-inset-right)' }}
        >
            {
                renderBackground ?
                    <div className="fixed inset-0 z-[-1] bg-bg">
                        <Image
                            className="pointer-events-none block h-full w-full object-cover object-[center_top] opacity-[0.16] max-sm:object-center"
                            src={metaDetails.metaItem.content.content.background}
                            renderFallback={renderBackgroundImageFallback}
                            alt={' '}
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,4,7,0.4)_0%,rgba(2,4,7,0.88)_50%,var(--color-bg)_100%)]" />
                    </div>
                    :
                    null
            }
            <HorizontalNavBar
                className="z-[1] flex-none self-stretch"
                backButton={true}
                fullscreenButton={true}
                navMenu={true}
                originPath={originPath}
            />
            <div ref={contentRef} className="relative z-0 flex min-h-0 flex-1 flex-row self-stretch">
                {
                    tabs.length > 0 ?
                        <VerticalNavBar
                            className="flex-none"
                            tabs={tabs}
                            selected={metaExtension !== null ? metaExtension.url : null}
                        />
                        :
                        null
                }
                <div className="flex min-w-0 flex-1 flex-col self-stretch overflow-y-auto px-8 pb-10 pt-2 max-sm:px-4 max-sm:pb-6">
                    <div className="flex h-[50vh] min-h-[22rem] flex-none flex-row items-stretch gap-8 self-stretch max-[60rem]:h-auto max-[60rem]:min-h-0 max-[60rem]:flex-col max-[60rem]:gap-6">
                        {
                            metaPath === null ?
                                <DelayedRenderer delay={500}>
                                    <MetaMessage label={t('ERR_NO_META_SELECTED')} />
                                </DelayedRenderer>
                                :
                                metaDetails.metaItem === null ?
                                    <MetaMessage label={t('ERR_NO_ADDONS_FOR_META')} />
                                    :
                                    metaDetails.metaItem.content.type === 'Err' ?
                                        <MetaMessage label={t('ERR_NO_META_FOUND')} />
                                        :
                                        metaDetails.metaItem.content.type === 'Loading' ?
                                            <MetaPreview.Placeholder className={metaPreviewClassName} />
                                            :
                                            <React.Fragment>
                                                <MetaPreview
                                                    className={cn(metaPreviewClassName, 'animate-in fade-in duration-300')}
                                                    name={metaDetails.metaItem.content.content.name}
                                                    logo={metaDetails.metaItem.content.content.logo}
                                                    runtime={metaDetails.metaItem.content.content.runtime}
                                                    releaseInfo={metaDetails.metaItem.content.content.releaseInfo}
                                                    released={metaDetails.metaItem.content.content.released}
                                                    description={
                                                        video !== null && typeof video.overview === 'string' && video.overview.length > 0 ?
                                                            video.overview
                                                            :
                                                            metaDetails.metaItem.content.content.description
                                                    }
                                                    links={metaDetails.metaItem.content.content.links}
                                                    inLibrary={metaDetails.metaItem.content.content.inLibrary}
                                                    toggleInLibrary={metaDetails.metaItem.content.content.inLibrary ? removeFromLibrary : addToLibrary}
                                                    watched={metaDetails.metaItem.content.content.watched}
                                                    toggleWatched={toggleWatched}
                                                    ratingInfo={metaDetails.ratingInfo}
                                                />
                                                <HeroMedia
                                                    className={cn(heroMediaClassName, 'animate-in fade-in duration-300')}
                                                    ytIds={trailerYtIds}
                                                    background={metaDetails.metaItem.content.content.background}
                                                    poster={metaDetails.metaItem.content.content.poster}
                                                    name={metaDetails.metaItem.content.content.name}
                                                />
                                            </React.Fragment>
                        }
                    </div>
                    {
                        streamPath !== null ?
                            <StreamsList
                                className="mt-8 flex-none self-stretch"
                                streams={metaDetails.streams}
                                video={video}
                                type={streamPath.type}
                                onEpisodeSearch={handleEpisodeSearch}
                            />
                            :
                            metaPath !== null ?
                                <VideosList
                                    className="mt-8 flex-none self-stretch"
                                    metaItem={metaDetails.metaItem}
                                    libraryItem={metaDetails.libraryItem}
                                    season={season}
                                    selectedVideoId={metaDetails.libraryItem?.state?.video_id}
                                    seasonOnSelect={seasonOnSelect}
                                    toggleNotifications={toggleNotifications}
                                />
                                :
                                null
                    }
                </div>
            </div>
            {
                metaExtension !== null ?
                    <ModalDialog
                        title={metaExtension.name}
                        onCloseRequest={clearMetaExtension}>
                        <iframe
                            className="block h-[70vh] w-[75vw] max-w-full rounded-card border-0"
                            sandbox={'allow-forms allow-scripts allow-same-origin'}
                            src={metaExtension.url}
                        />
                    </ModalDialog>
                    :
                    null
            }
        </div>
    );
};

// The details column: flex 0 0 clamp(20rem,40%,38rem), full-height in the band;
// stacks full-width below the 60rem breakpoint.
const metaPreviewClassName = 'min-h-0 min-w-0 shrink-0 grow-0 basis-[clamp(20rem,40%,38rem)] self-stretch max-[60rem]:basis-auto';
// The hero fills the remaining width and the whole 50vh band (aspect auto); below
// 60rem it reverts to a 16:9 block.
const heroMediaClassName = 'h-full min-w-0 flex-1 self-stretch aspect-auto max-[60rem]:h-auto max-[60rem]:flex-none max-[60rem]:aspect-video';

const MetaDetailsFallback = () => (
    <div
        className="relative box-border flex h-full w-full flex-col"
        style={{ paddingLeft: 'var(--safe-area-inset-left)', paddingRight: 'var(--safe-area-inset-right)' }}
    >
        <HorizontalNavBar
            className="z-[1] flex-none self-stretch"
            backButton={true}
            fullscreenButton={true}
            navMenu={true}
        />
    </div>
);

export default withCoreSuspender(MetaDetails, MetaDetailsFallback);
