// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import { Button } from 'rillio/components/ui/button';

type Props = {
    label: string,
    href?: string,
    target?: string,
    onClick?: () => void,
};

const Link = ({ label, href, target, onClick }: Props) => {
    return (
        <Button
            variant="link"
            className="h-8 flex-none self-start text-accent hover:underline hover:brightness-110"
            title={label}
            target={target ?? '_blank'}
            href={href}
            onClick={onClick}
        >
            {label}
        </Button>
    );
};

export default Link;
