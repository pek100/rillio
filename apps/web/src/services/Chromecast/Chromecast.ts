// Copyright (C) 2017-2023 Smart code 203358507

import EventEmitter from 'eventemitter3';
import ChromecastTransport, { ChromecastTransportInstance } from './ChromecastTransport';

type ChromecastListener = (...args: any[]) => void;

export interface ChromecastInstance {
    readonly active: boolean;
    readonly error: Error | null;
    readonly starting: boolean;
    readonly transport: ChromecastTransportInstance | null;
    start(): void;
    stop(): void;
    on(name: string, listener: ChromecastListener): void;
    off(name: string, listener: ChromecastListener): void;
}

interface ChromecastConstructor {
    new (): ChromecastInstance;
}

function Chromecast(this: ChromecastInstance) {
    let active = false;
    let error: Error | null = null;
    let starting = false;
    let transport: ChromecastTransportInstance | null = null;

    const events = new EventEmitter();

    function onTransportInit() {
        active = true;
        error = null;
        starting = false;
        onStateChanged();
    }
    function onTransportInitError(args: any) {
        console.error(args);
        active = false;
        error = new Error('Google Cast API not available', { cause: args });
        starting = false;
        onStateChanged();
        transport = null;
    }
    function onStateChanged() {
        events.emit('stateChanged');
    }

    Object.defineProperties(this, {
        active: {
            configurable: false,
            enumerable: true,
            get: function() {
                return active;
            }
        },
        error: {
            configurable: false,
            enumerable: true,
            get: function() {
                return error;
            }
        },
        starting: {
            configurable: false,
            enumerable: true,
            get: function() {
                return starting;
            }
        },
        transport: {
            configurable: false,
            enumerable: true,
            get: function() {
                return transport;
            }
        }
    });

    this.start = function() {
        if (active || error instanceof Error || starting) {
            return;
        }

        starting = true;
        transport = new ChromecastTransport();
        transport.on('init', onTransportInit);
        transport.on('init-error', onTransportInitError);
        onStateChanged();
    };
    this.stop = function() {
        active = false;
        error = null;
        starting = false;
        onStateChanged();
        if (transport !== null) {
            transport.removeAllListeners();
            transport = null;
        }
    };
    this.on = function(name: string, listener: ChromecastListener) {
        events.on(name, listener);
    };
    this.off = function(name: string, listener: ChromecastListener) {
        events.off(name, listener);
    };
}

export default Chromecast as unknown as ChromecastConstructor;
