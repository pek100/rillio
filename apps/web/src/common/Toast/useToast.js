// Copyright (C) 2017-2024 Smart code 203358507

// The legacy toast context was replaced by the Sonner-backed adapter in the
// foundation kit (components/ui/use-toast). This module now forwards to that
// adapter so every existing `require('rillio/common/Toast/useToast')` call site
// keeps working unchanged - the adapter preserves the exact legacy API
// (show / remove / clear / addFilter / removeFilter).
const { useToast } = require('rillio/components/ui/use-toast');

module.exports = useToast;
