// Copyright (C) 2017-2024 Smart code 203358507

// Legacy toast barrel, now forwarding to the Sonner-backed foundation-kit adapter
// (components/ui/use-toast). ToastProvider renders the single <Toaster/>; useToast
// exposes the preserved legacy API. The old reducer-driven ToastProvider /
// ToastContext / ToastItem were removed in the Phase 3 nav-shell rewrite.
const { ToastProvider, useToast } = require('rillio/components/ui/use-toast');

module.exports = {
    ToastProvider,
    useToast
};
