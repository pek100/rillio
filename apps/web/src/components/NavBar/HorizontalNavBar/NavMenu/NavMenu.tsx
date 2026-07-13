// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Account hub menu. Clean-room rewrite of the legacy custom Popup onto the kit's
 * Radix Popover (arbitrary anchored content, per the component map). Open state is
 * controlled here and closes when the route loses focus (route change / navigation),
 * matching the legacy useRouteFocused behaviour. The `renderLabel` render-prop is
 * preserved so call sites (TopNav, HorizontalNavBar) supply their own trigger chip;
 * it now receives only `{ active }` (Radix injects the trigger's ref/handlers via
 * asChild). Selecting any item closes the popover; DisplayNameEdit stops propagation
 * so entering edit mode does not dismiss it.
 */

import React from 'react';
import useRouteFocused from 'rillio/common/useRouteFocused';
import { Popover, PopoverTrigger, PopoverContent } from 'rillio/components/ui/popover';
import NavMenuContent from './NavMenuContent';

type RenderLabelArgs = { active: boolean };

type Props = {
    renderLabel: (args: RenderLabelArgs) => React.ReactElement,
};

const NavMenu = ({ renderLabel }: Props) => {
    const routeFocused = useRouteFocused();
    const [open, setOpen] = React.useState(false);
    const close = React.useCallback(() => setOpen(false), []);

    React.useEffect(() => {
        if (!routeFocused) {
            setOpen(false);
        }
    }, [routeFocused]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {renderLabel({ active: open })}
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={12}
                className="w-auto overflow-hidden rounded-card border border-line bg-surface p-0 shadow-elevated"
            >
                <NavMenuContent onSelect={close} />
            </PopoverContent>
        </Popover>
    );
};

export default NavMenu;
