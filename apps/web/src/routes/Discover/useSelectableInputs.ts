// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslate } from 'rillio/common';
import { toPath } from 'rillio-router';

// The discover selectable shape is the dynamic core model state; the mapper stays
// `any`-based and the consumer annotates the returned selectable inputs.
const mapSelectableInputs = (discover: any, t: any, navigate: (path: string) => void): [any[], any] => {
    const selectedType = discover.selectable.types.find(({ selected }: any) => selected);
    const typeSelect = {
        options: discover.selectable.types
            .map(({ type, deepLinks }: any) => ({
                value: deepLinks.discover,
                label: t.stringWithPrefix(type, 'TYPE_')
            })),
        value: selectedType
            ? selectedType.deepLinks.discover
            : undefined,
        title: discover.selected !== null
            ? () => t.stringWithPrefix(discover.selected.request.path.type, 'TYPE_')
            : t.string('SELECT_TYPE'),
        onSelect: (value: string) => {
            navigate(toPath(value));
        }
    };
    const catalogSelect = {
        options: discover.selectable.catalogs
            .map(({ id, name, addon, deepLinks }: any) => ({
                value: deepLinks.discover,
                label: t.catalogTitle({ addon, id, name }),
                title: `${name} (${addon.manifest.name})`
            })),
        value: discover.selectable.catalogs
            .filter(({ selected }: any) => selected)
            .map(({ deepLinks }: any) => deepLinks.discover),
        title: discover.selected !== null
            ? () => {
                const selectableCatalog = discover.selectable.catalogs
                    .find(({ id }: any) => id === discover.selected.request.path.id);
                return selectableCatalog ? t.catalogTitle(selectableCatalog, false) : discover.selected.request.path.id;
            }
            :
            t.string('SELECT_CATALOG'),
        onSelect: (value: string) => {
            navigate(toPath(value));
        }
    };
    const extraSelects = discover.selectable.extra.map(({ name, isRequired, options }: any) => {
        const selectedExtra = options.find(({ selected }: any) => selected);
        return {
            isRequired: isRequired,
            options: options.map(({ value, deepLinks }: any) => ({
                label: typeof value === 'string' ? t.string(value) : t.string('NONE'),
                value: JSON.stringify({
                    href: deepLinks.discover,
                    value
                })
            })),
            value: selectedExtra ? JSON.stringify({
                href: selectedExtra.deepLinks.discover,
                value: selectedExtra.value,
            }) : undefined,
            title: options.some(({ selected, value }: any) => selected && value === null) ?
                () => t.string(name.toUpperCase())
                : selectedExtra ? t.string(selectedExtra.value) : () => t.string(name.toUpperCase()),
            onSelect: (value: string) => {
                const { href } = JSON.parse(value);
                navigate(toPath(href));
            }
        };
    });
    // Consistent order: type, then the addon's filters (genre, ...), then the
    // catalog (Popular / New / ...). The option LISTS themselves come from the
    // installed addons -- they are not a fixed set we can hardcode here.
    return [[typeSelect, ...extraSelects, catalogSelect], discover.selectable.nextPage];
};

const useSelectableInputs = (discover: Discover): [any[], any] => {
    const t = useTranslate();
    const navigate = useNavigate();
    const selectableInputs = React.useMemo(() => {
        return mapSelectableInputs(discover, t, navigate);
    }, [discover.selected, discover.selectable]);
    return selectableInputs;
};

export default useSelectableInputs;
