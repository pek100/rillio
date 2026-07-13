// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCloseModalRoute } from 'rillio-router';
import throttle from 'lodash.throttle';
import { usePlatform, useProfile, useStreamingServer, useRouteFocused, withCoreSuspender } from 'rillio/common';
import { ModalRoute } from 'rillio/components/ui/dialog';
import { SECTIONS } from './constants';
import Menu from './Menu';
import General from './General';
import Interface from './Interface';
import Player from './Player';
import Streaming from './Streaming';
import Shortcuts from './Shortcuts';
import Info from './Info';

// Per-route panel size (was Settings.less min() rules on the modal-shell panel).
const PANEL_SIZE = 'h-[min(46rem,calc(100vh-6rem))] w-[min(64rem,calc(100vw-4rem))]';

const Settings = () => {
    const routeFocused = useRouteFocused();
    const profile = useProfile();
    const platform = usePlatform();
    const streamingServer = useStreamingServer();

    const sectionsContainerRef = useRef<HTMLDivElement>(null);
    const generalSectionRef = useRef<HTMLDivElement>(null);
    const interfaceSectionRef = useRef<HTMLDivElement>(null);
    const playerSectionRef = useRef<HTMLDivElement>(null);
    const streamingServerSectionRef = useRef<HTMLDivElement>(null);
    const shortcutsSectionRef = useRef<HTMLDivElement>(null);

    const sections = useMemo(() => ([
        { ref: generalSectionRef, id: SECTIONS.GENERAL },
        { ref: interfaceSectionRef, id: SECTIONS.INTERFACE },
        { ref: playerSectionRef, id: SECTIONS.PLAYER },
        { ref: streamingServerSectionRef, id: SECTIONS.STREAMING },
        { ref: shortcutsSectionRef, id: SECTIONS.SHORTCUTS },
    ]), []);

    const [selectedSectionId, setSelectedSectionId] = useState(SECTIONS.GENERAL);

    const updateSelectedSectionId = useCallback(() => {
        const container = sectionsContainerRef.current;
        if (!container) return;

        const availableSections = sections.filter((section) => section.ref.current);
        if (!availableSections.length) return;

        const { scrollTop, clientHeight, scrollHeight, offsetTop } = container;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

        if (isAtBottom) {
            setSelectedSectionId(availableSections[availableSections.length - 1].id);
            return;
        }

        const marker = scrollTop + 50;
        const activeSection = availableSections.reduce((current, section) => {
            const sectionTop = section.ref.current!.offsetTop + offsetTop;
            return sectionTop <= marker ? section : current;
        }, availableSections[0]);

        setSelectedSectionId(activeSection.id);
    }, [sections]);

    const onMenuSelect = useCallback((sectionId: string) => {
        const section = sections.find((section) => section.id === sectionId);
        const container = sectionsContainerRef.current;
        section && container?.scrollTo({
            top: section.ref.current!.offsetTop - container!.offsetTop,
            behavior: 'smooth'
        });
    }, [sections]);

    const onContainerScroll = useCallback(throttle(() => {
        updateSelectedSectionId();
    }, 50), []);

    useLayoutEffect(() => {
        if (routeFocused) {
            updateSelectedSectionId();
        }
    }, [routeFocused]);

    // /settings is a modal route: it floats over whatever page you came from, which the
    // router keeps mounted and visible (blurred) beneath. Radix Dialog gives Escape,
    // outside-click, focus-trap and aria for free; onClose drives the URL view-stack.
    const closeSettings = useCloseModalRoute();

    return (
        <ModalRoute
            open
            onClose={closeSettings}
            showClose={false}
            title="Settings"
            hideHeader
            className={`flex flex-col gap-0 overflow-hidden border border-line p-0 max-w-none ${PANEL_SIZE}`}
        >
            <div className="flex h-[calc(100%-var(--safe-area-inset-bottom,0rem))] w-full flex-row max-[640px]:flex-col-reverse">
                <Menu
                    selected={selectedSectionId}
                    streamingServer={streamingServer}
                    onSelect={onMenuSelect}
                />
                <div
                    ref={sectionsContainerRef}
                    onScroll={onContainerScroll}
                    className="flex-1 self-stretch overflow-y-auto px-12 max-[640px]:px-6"
                >
                    <General
                        ref={generalSectionRef}
                        profile={profile}
                    />
                    <Interface
                        ref={interfaceSectionRef}
                        profile={profile}
                    />
                    <Player
                        ref={playerSectionRef}
                        profile={profile}
                    />
                    <Streaming
                        ref={streamingServerSectionRef}
                        profile={profile}
                        streamingServer={streamingServer}
                    />
                    {
                        !platform.isMobile && <Shortcuts ref={shortcutsSectionRef} />
                    }
                    <Info streamingServer={streamingServer} />
                </div>
            </div>
        </ModalRoute>
    );
};

const SettingsFallback = () => {
    const closeSettings = useCloseModalRoute();
    return (
        <ModalRoute
            open
            onClose={closeSettings}
            showClose={false}
            title="Settings"
            hideHeader
            className={`gap-0 overflow-hidden border border-line p-0 max-w-none ${PANEL_SIZE}`}
        >
            {null}
        </ModalRoute>
    );
};

export default withCoreSuspender(Settings, SettingsFallback);
