// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import ReactDOM from 'react-dom';
import FocusLock from 'react-focus-lock';
import { cn } from 'rillio/components/ui/cn';
import { useModalsContainer } from '../ModalsContainerContext';

type Props = {
    className?: string,
    autoFocus?: boolean,
    disabled?: boolean,
    children?: React.ReactNode,
    [key: string]: any,
};

const Modal = React.forwardRef<HTMLElement, Props>(({ className, autoFocus, disabled, children, ...props }, ref) => {
    const modalsContainer = useModalsContainer();
    return ReactDOM.createPortal(
        <FocusLock ref={ref} className={cn('modal-container', className)} autoFocus={!!autoFocus} disabled={!!disabled} lockProps={props}>
            {children}
        </FocusLock>,
        modalsContainer as HTMLElement
    );
});

Modal.displayName = 'Modal';

export default Modal;
