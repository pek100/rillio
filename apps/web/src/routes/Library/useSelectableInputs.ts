// Copyright (C) 2017-2023 Smart code 203358507

import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslate } from 'rillio/common';
import { toPath } from 'rillio-router';

// The library selectable shape is the dynamic core model state; the mapper stays
// `any`-based and the consumer annotates the returned selectable inputs.
const mapSelectableInputs = (library: any, t: any, navigate: (path: string) => void): [any, any, any] => {
    const selectedType = library.selectable.types.find(({ selected }: any) => selected) || library.selectable.types.find(({ type }: any) => type === null);
    const typeSelect = {
        options: library.selectable.types
            .map(({ type, deepLinks }: any) => ({
                value: deepLinks.library,
                label: type === null ? t.string('TYPE_ALL') : t.stringWithPrefix(type, 'TYPE_')
            })),
        value: selectedType?.deepLinks.library,
        onSelect: (value: string) => {
            navigate(toPath(value));
        }
    };
    const sortChips = {
        options: library.selectable.sorts
            .map(({ sort, deepLinks }: any) => ({
                value: deepLinks.library,
                label: t.stringWithPrefix(sort.toUpperCase(), 'SORT_')
            })),
        selected: library.selectable.sorts
            .filter(({ selected }: any) => selected)
            .map(({ deepLinks }: any) => deepLinks.library),
        onSelect: (value: string) => {
            navigate(toPath(value));
        }
    };
    return [typeSelect, sortChips, library.selectable.nextPage];
};

const useSelectableInputs = (library: Library): [any, any, any] => {
    const t = useTranslate();
    const navigate = useNavigate();
    const selectableInputs = React.useMemo(() => {
        return mapSelectableInputs(library, t, navigate);
    }, [library]);
    return selectableInputs;
};

export default useSelectableInputs;
