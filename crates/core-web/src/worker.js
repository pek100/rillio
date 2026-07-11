const Bridge = require('./bridge');

const bridge = new Bridge(self, self);

self.init = async () => {
    // TODO remove the document shim when this PR is merged
    // https://github.com/cfware/babel-plugin-bundled-import-meta/pull/26
    self.document = {
        baseURI: self.location.href
    };
    self.local_storage_get_item = async (key) => bridge.call(['localStorage', 'getItem'], [key]);
    self.local_storage_set_item = async (key, value) => bridge.call(['localStorage', 'setItem'], [key, value]);
    self.local_storage_remove_item = async (key) => bridge.call(['localStorage', 'removeItem'], [key]);
    const { default: initialize_api, initialize_runtime, get_state, get_debug_state, dispatch, decode_stream, encode_stream } = require('./rillio_core_web.js');
    self.getState = get_state;
    self.getDebugState = get_debug_state;
    self.dispatch = dispatch;
    self.decodeStream = decode_stream;
    self.encodeStream = encode_stream;
    await initialize_api(require('./rillio_core_web_bg.wasm'));
    await initialize_runtime((event) => bridge.call(['onCoreEvent'], [event]));
};
