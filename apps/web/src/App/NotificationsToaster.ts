import React from 'react';
import { useNotifications, useToast } from 'rillio/common';

// Surfaces new-episode notifications (ctx.notifications) as transient toasts.
// The bell/panel was dropped in the Rillio redesign; new content now arrives as
// a toast pointing at the Library, where each item still carries its own
// new-episode badge. ctx.notifications.items is { [metaId]: NotificationItem[] }.
//
// NOTE: this is the summary version. A richer per-show toast (resolved title +
// deep link straight to the episode) needs a notifications<->library join and
// real notification data to verify; deferred until there is data to test against.
const NotificationsToaster = () => {
    const notifications = useNotifications();
    const toast = useToast();
    // null until the first pass so an existing backlog on load isn't toasted.
    const seen = React.useRef<Set<string> | null>(null);

    React.useEffect(() => {
        const items = (notifications && notifications.items) || {};
        const active = Object.keys(items).filter((id) => Array.isArray(items[id]) && items[id].length > 0);

        if (seen.current === null) {
            seen.current = new Set(active);
            return;
        }

        const fresh = active.filter((id) => !seen.current!.has(id));
        // Re-sync to what's currently active so dismissed metas can toast again later.
        seen.current = new Set(active);

        if (fresh.length === 0) {
            return;
        }

        const total = fresh.reduce((sum, id) => sum + items[id].length, 0);
        toast.show({
            type: 'info',
            title: fresh.length === 1 ? 'New episode available' : `${fresh.length} shows have new episodes`,
            message: total === 1 ? '1 new episode in your Library' : `${total} new episodes in your Library`,
            timeout: 6000,
            dataset: { type: 'Notification' }
        });
    }, [notifications]);

    return null;
};

export default NotificationsToaster;
