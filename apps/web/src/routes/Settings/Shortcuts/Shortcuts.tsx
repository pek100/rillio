import React, { forwardRef } from 'react';
import { Section } from '../components';
import { ShortcutsGroup } from 'rillio/components';
import { useShortcuts } from 'rillio/common';

const Shortcuts = forwardRef<HTMLDivElement>((_, ref) => {
    const { grouped } = useShortcuts();

    return (
        <Section ref={ref} label={'SETTINGS_NAV_SHORTCUTS'}>
            {
                grouped.map(({ name, label, shortcuts }) => (
                    <ShortcutsGroup
                        key={name}
                        className="mb-12 w-full"
                        label={label}
                        shortcuts={shortcuts}
                    />
                ))
            }
        </Section>
    );
});

Shortcuts.displayName = 'Shortcuts';

export default Shortcuts;
