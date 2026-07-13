// Copyright (C) 2017-2024 Smart code 203358507

// Interop shim: EventModal is now a .tsx default export. Unwrap `.default` so the
// ESM barrel's default import resolves to the component.
module.exports = require('./EventModal').default;
