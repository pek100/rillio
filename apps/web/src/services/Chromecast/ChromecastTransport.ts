// Copyright (C) 2017-2023 Smart code 203358507

import EventEmitter from 'eventemitter3';
import hat from 'hat';

// The Google Cast SDK injects a global `cast` (and `chrome.cast`) object at
// runtime. No @types package is installed for it, so it is typed as `any` here.
declare const cast: any;

const MESSAGE_NAMESPACE = 'urn:x-cast:com.stremio';
const CHUNK_SIZE = 20000;

type CastListener = (...args: any[]) => void;

let castAPIAvailable: boolean | null = null;
const castAPIEvents = new EventEmitter();
(window as any)['__onGCastApiAvailable'] = function(available: boolean) {
    delete (window as any)['__onGCastApiAvailable'];
    castAPIAvailable = !!available;
    castAPIEvents.emit('availabilityChanged');
};

const initialize = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        function onCastAPIAvailabilityChanged() {
            castAPIEvents.off('availabilityChanged', onCastAPIAvailabilityChanged);
            if (castAPIAvailable) {
                resolve();
            } else {
                reject(new Error('window.cast api not available', { cause: 'castAPIAvailable is null.' }));
            }
        }
        if (castAPIAvailable !== null) {
            onCastAPIAvailabilityChanged();
        } else {
            castAPIEvents.on('availabilityChanged', onCastAPIAvailabilityChanged);
        }
    });
};

export interface ChromecastTransportInstance {
    on(name: string, listener: CastListener): void;
    off(name: string, listener: CastListener): void;
    removeAllListeners(): void;
    getCastState(): any;
    getSessionState(): any;
    getCastDevice(): any;
    setOptions(options: any): void;
    requestSession(): Promise<any>;
    endCurrentSession(stopCasting: boolean): void;
    sendMessage(message: any): Promise<any>;
}

interface ChromecastTransportConstructor {
    new (): ChromecastTransportInstance;
}

function ChromecastTransport(this: ChromecastTransportInstance) {
    const events = new EventEmitter();
    const messages: Record<string, string[]> = {};

    initialize()
        .then(() => {
            cast.framework.CastContext.getInstance().addEventListener(
                cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                onCastStateChanged
            );
            cast.framework.CastContext.getInstance().addEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                onSesstionStateChanged
            );
        })
        .then(() => {
            try {
                events.emit('init');
            } catch (error) {
                console.error('ChromecastTransport', error);
            }
        })
        .catch((error) => {
            events.emit('init-error', error);
        });

    function onMessage(_: any, message: string) {
        try {
            const { id, chunk, index, length } = JSON.parse(message);
            messages[id] = messages[id] || [];
            messages[id][index] = chunk;
            if (Object.keys(messages[id]).length === length) {
                const parsedMessage = JSON.parse(messages[id].join(''));
                delete messages[id];
                events.emit('message', parsedMessage);
            }
        } catch (error) {
            events.emit('message-error', error);
        }
    }
    function onApplicationStatusChanged(event: any) {
        events.emit(cast.framework.CastSession.APPLICATION_STATUS_CHANGED, event);
    }
    function onApplicationMetadataChanged(event: any) {
        events.emit(cast.framework.CastSession.APPLICATION_METADATA_CHANGED, event);
    }
    function onActiveInputStateChanged(event: any) {
        events.emit(cast.framework.CastSession.ACTIVE_INPUT_STATE_CHANGED, event);
    }
    function onVolumeChanged(event: any) {
        events.emit(cast.framework.CastSession.VOLUME_CHANGED, event);
    }
    function onMediaSessionChanged(event: any) {
        events.emit(cast.framework.CastSession.MEDIA_SESSION, event);
    }
    function onCastStateChanged(event: any) {
        events.emit(cast.framework.CastContextEventType.CAST_STATE_CHANGED, event);
    }
    function onSesstionStateChanged(event: any) {
        events.emit(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, event);
        switch (event.sessionState) {
            case cast.framework.SessionState.SESSION_STARTED: {
                event.session.addMessageListener(MESSAGE_NAMESPACE, onMessage);
                event.session.addEventListener(cast.framework.CastSession.APPLICATION_STATUS_CHANGED, onApplicationStatusChanged);
                event.session.addEventListener(cast.framework.CastSession.APPLICATION_METADATA_CHANGED, onApplicationMetadataChanged);
                event.session.addEventListener(cast.framework.CastSession.ACTIVE_INPUT_STATE_CHANGED, onActiveInputStateChanged);
                event.session.addEventListener(cast.framework.CastSession.VOLUME_CHANGED, onVolumeChanged);
                event.session.addEventListener(cast.framework.CastSession.MEDIA_SESSION, onMediaSessionChanged);
                break;
            }
            case cast.framework.SessionState.SESSION_ENDED: {
                event.session.removeMessageListener(MESSAGE_NAMESPACE, onMessage);
                event.session.removeEventListener(cast.framework.CastSession.APPLICATION_STATUS_CHANGED, onApplicationStatusChanged);
                event.session.removeEventListener(cast.framework.CastSession.APPLICATION_METADATA_CHANGED, onApplicationMetadataChanged);
                event.session.removeEventListener(cast.framework.CastSession.ACTIVE_INPUT_STATE_CHANGED, onActiveInputStateChanged);
                event.session.removeEventListener(cast.framework.CastSession.VOLUME_CHANGED, onVolumeChanged);
                event.session.removeEventListener(cast.framework.CastSession.MEDIA_SESSION, onMediaSessionChanged);
                break;
            }
        }
    }

    this.on = function(name: string, listener: CastListener) {
        events.on(name, listener);
    };
    this.off = function(name: string, listener: CastListener) {
        events.off(name, listener);
    };
    this.removeAllListeners = function() {
        events.removeAllListeners();
    };
    this.getCastState = function() {
        return cast.framework.CastContext.getInstance().getCastState();
    };
    this.getSessionState = function() {
        return cast.framework.CastContext.getInstance().getSessionState();
    };
    this.getCastDevice = function() {
        const session = cast.framework.CastContext.getInstance().getCurrentSession();
        if (session !== null) {
            return session.getCastDevice();
        }

        return null;
    };
    this.setOptions = function(options: any) {
        cast.framework.CastContext.getInstance().setOptions(options);
    };
    this.requestSession = function() {
        return cast.framework.CastContext.getInstance().requestSession();
    };
    this.endCurrentSession = function(stopCasting: boolean) {
        cast.framework.CastContext.getInstance().endCurrentSession(stopCasting);
    };
    this.sendMessage = function(message: any) {
        const castSession = cast.framework.CastContext.getInstance().getCurrentSession();
        if (castSession !== null) {
            const serializedMessage = JSON.stringify(message);
            const chunksCount = Math.ceil(serializedMessage.length / CHUNK_SIZE);
            const chunks: string[] = [];
            for (let i = 0; i < chunksCount; i++) {
                const start = i * CHUNK_SIZE;
                const chunk = serializedMessage.slice(start, start + CHUNK_SIZE);
                chunks.push(chunk);
            }
            const id = hat();
            return Promise.all(chunks.map((chunk, index) => {
                return castSession.sendMessage(MESSAGE_NAMESPACE, {
                    id,
                    chunk,
                    index,
                    length: chunks.length
                });
            }));
        } else {
            return Promise.reject(new Error('Session not started', { cause: 'castSession is null.' }));
        }
    };
}

export default ChromecastTransport as unknown as ChromecastTransportConstructor;
