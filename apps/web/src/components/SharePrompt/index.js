// Copyright (C) 2017-2024 Smart code 203358507

// Interop shim: SharePrompt is now a .tsx default export, but a CommonJS consumer
// (MetaPreview) still does `require('rillio/components/SharePrompt')` and uses the
// result directly. Unwrap `.default` so both that require and the ESM barrel's
// default import resolve to the component.
module.exports = require('./SharePrompt').default;
