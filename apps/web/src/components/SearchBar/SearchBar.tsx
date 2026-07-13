// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Inline pill search input. Clean-room rewrite onto the kit Input, composed inside a
 * relative pill wrapper with a trailing search glyph (shadcn Input has no icon slot,
 * so we wrap it - the standard pattern). Flat/borderless on a surface fill, with a
 * focus-within accent border. Same controlled contract as before
 * ({ className, title, value, onChange }); `SearchBar.Placeholder` is the loading twin.
 */

import React, { forwardRef, type ChangeEvent } from 'react';
import Icon from '@stremio/stremio-icons/react';
import { cn } from 'rillio/components/ui/cn';
import { Input } from 'rillio/components/ui/input';

type Props = {
    className?: string;
    title?: string;
    value?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

type PlaceholderProps = {
    className?: string;
    title?: string;
};

const SearchBarPlaceholder = ({ className, title }: PlaceholderProps) => (
    <div className={cn('flex h-14 items-center rounded-full bg-surface px-4 select-none', className)}>
        <div className="flex-1 truncate text-[1.1rem] text-fg-subtle">{title}</div>
        <Icon className="ml-4 size-6 shrink-0 text-surface" name="search" />
    </div>
);

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar({ className, title, value, onChange }, ref) {
    return (
        <label
            title={title}
            className={cn(
                'flex h-12 items-center rounded-full border-2 border-transparent bg-surface-hover px-6 cursor-text transition-colors duration-150 focus-within:border-highlight',
                className,
            )}
        >
            <Input
                ref={ref}
                type="text"
                placeholder={title}
                value={value}
                onChange={onChange}
                className="h-auto flex-1 rounded-none bg-transparent p-0 text-base text-fg focus-visible:outline-none"
            />
            <Icon className="ml-4 size-6 shrink-0 text-fg-muted opacity-60" name="search" />
        </label>
    );
}) as React.ForwardRefExoticComponent<Props & React.RefAttributes<HTMLInputElement>> & { Placeholder: typeof SearchBarPlaceholder };

SearchBar.Placeholder = SearchBarPlaceholder;

export default SearchBar;
