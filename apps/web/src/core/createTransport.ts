import Bridge from '@rillio/core-web/bridge';
import { getItem, setItem, removeItem } from 'rillio/common/profileStorage';

// The wasm core's storage RPC resolves ['rillioStorage', ...] on window (see
// crates/core-web/src/worker.js): every core bucket read/write lands in the
// ACTIVE profile's namespace. Must exist before the worker's first storage
// call; defining it before the Bridge is constructed guarantees that.
(window as any).rillioStorage = { getItem, setItem, removeItem };

const worker = new Worker(`${process.env.COMMIT_HASH}/scripts/worker.js`);
const bridge = new Bridge(window, worker);

const createTransport = (): CoreTransport => {
    const init = (args: object): Promise<void> => {
        return bridge.call(['init'], [args]);
    };

    const getState = (model: string): Promise<object> => {
        return bridge.call(['getState'], [model]);
    };

    const dispatch = (action: DispatchAction, model?: string): Promise<void> => {
        return bridge.call(['dispatch'], [action, model]);
    };

    const encodeStream = (stream: Stream): Promise<string> => {
        return bridge.call(['encodeStream'], [stream]);
    };

    const decodeStream = (stream: string): Promise<Stream> => {
        return bridge.call(['decodeStream'], [stream]);
    };

    return {
        init,
        getState,
        dispatch,
        encodeStream,
        decodeStream,
    };
};

export default createTransport;
