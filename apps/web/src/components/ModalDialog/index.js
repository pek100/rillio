// Copyright (C) 2017-2024 Smart code 203358507

// Interop shim: ModalDialog is now a .tsx default export, but a CommonJS consumer
// (AddonDetailsModal) still does `require('rillio/components/ModalDialog')` and uses
// the result directly. Unwrap `.default` here so both that require and the ESM
// barrel's default import resolve to the component.
module.exports = require('./ModalDialog').default;
