import React, { useMemo, useRef, useState } from "react";
import {
    Filters,
    ChoiceList,
    TextField,
    Card,
    Box,
    Select,
    Button,
    BlockStack,
    Autocomplete,
} from "@shopify/polaris";

import { getAllFilters } from "../constants";
import { t } from "i18next";

export default function ProductsFilters({
    queryValue,
    appliedFilters,
    filterState,
    onFilterChange,
    onQueryChange,
    onQueryClear,
    onClearAll,
}) {
    const allFilters = getAllFilters();

    /* ------------------------------
       Draft UI state
    ------------------------------ */
    const [draftFilters, setDraftFilters] = useState({});
    const [filtersKey, setFiltersKey] = useState(0);

    /* ------------------------------
       Autocomplete state
    ------------------------------ */
    const [autocompleteOptions, setAutocompleteOptions] = useState({});
    const [autocompleteLoading, setAutocompleteLoading] = useState({});
    const debounceTimers = useRef({});

    /* ------------------------------
       Fetch autocomplete options
    ------------------------------ */
    const fetchAutocompleteOptions = async (filter, query) => {
        if (!filter.api || !query) return;

        setAutocompleteLoading((prev) => ({
            ...prev,
            [filter.key]: true,
        }));

        try {
            const res = await fetch(
                `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`
            );

            if (!res.ok) throw new Error("Failed");

            const data = await res.json();

            setAutocompleteOptions((prev) => ({
                ...prev,
                [filter.key]: data?.data?.map((item) => ({
                    label: item.title,
                    value: item.title,
                })),
            }));
        } catch {
            setAutocompleteOptions((prev) => ({
                ...prev,
                [filter.key]: [],
            }));
        } finally {
            setAutocompleteLoading((prev) => ({
                ...prev,
                [filter.key]: false,
            }));
        }
    };

    /* ------------------------------
       Build filters
    ------------------------------ */
    const filters = allFilters.map((filter) => {
        const committed = filterState.find(
            (f) => f.field === filter.key
        );

        const draft = draftFilters[filter.key] || {
            operator: filter.operators[0] || "",
            value: "",
        };

        return {
            key: filter.key,
            label: filter.label,
            filter: (
                <Box width="280px">
                    <BlockStack gap="200">
                        {/* Operator */}
                        {filter.operators.length > 0 &&
                            <Select
                                labelHidden
                                options={filter.operators.map((op) => ({
                                    label: op,
                                    value: op,
                                }))}
                                value={draft.operator}
                                onChange={(nextOperator) =>
                                    setDraftFilters((prev) => ({
                                        ...prev,
                                        [filter.key]: {
                                            ...draft,
                                            operator: nextOperator,
                                        },
                                    }))
                                }
                            />}

                        {/* Value */}
                        <FilterValueInput
                            filter={filter}
                            value={draft.value}
                            options={autocompleteOptions[filter.key] || []}
                            loading={autocompleteLoading[filter.key]}
                            onChange={(nextValue) =>
                                setDraftFilters((prev) => ({
                                    ...prev,
                                    [filter.key]: {
                                        ...draft,
                                        value: nextValue,
                                    },
                                }))
                            }
                            onSearch={(query) => {
                                clearTimeout(debounceTimers.current[filter.key]);

                                debounceTimers.current[filter.key] =
                                    setTimeout(() => {
                                        fetchAutocompleteOptions(filter, query);
                                    }, 300);
                            }}
                        />
                    </BlockStack>

                    {/* Apply */}
                    <Box paddingBlockStart="300">
                        <Button
                            variant="primary"
                            disabled={!draft.value}
                            onClick={() => {
                                onFilterChange(filter.key, draft);
                                setFiltersKey((k) => k + 1); // close popover
                            }}
                        >
                            {t("addFilter")}
                        </Button>
                    </Box>


                </Box>
            ),
        };
    });

    return (
        <Box paddingBlockEnd="400">
            <Card>
                <Filters
                    key={filtersKey}
                    queryValue={queryValue}
                    queryPlaceholder={t("searchPlaceholder")}
                    filters={filters}
                    appliedFilters={appliedFilters}
                    onQueryChange={onQueryChange}
                    onQueryClear={onQueryClear}
                    onClearAll={onClearAll}
                />
            </Card>
        </Box>
    );
}

/* ======================================================
   Value Input Renderer
====================================================== */

function FilterValueInput({
    filter,
    value,
    onChange,
    onSearch,
    options,
    loading,
}) {
    const [inputValue, setInputValue] = useState("");

    if (filter.isSearchable) {
        return (
            <Autocomplete
                options={options}
                selected={value ? [value] : []}
                loading={loading}
                onSelect={([selected]) => {
                    onChange(selected);

                    const selectedOption = options.find(
                        (o) => o.value === selected
                    );

                    if (selectedOption) {
                        setInputValue(selectedOption.label);
                    }
                }}
                textField={
                    <Autocomplete.TextField
                        labelHidden
                        placeholder={`Search ${filter.label}`}
                        autoComplete="off"
                        value={inputValue}
                        onChange={(text) => {
                            setInputValue(text);
                            onSearch(text);
                        }}
                    />
                }
            />
        );
    }

    if (filter.type === "enum") {
        return (
            <ChoiceList
                titleHidden
                choices={filter.values.map((v) => ({
                    label: v,
                    value: v,
                }))}
                selected={value ? [value] : []}
                onChange={([next]) => onChange(next)}
            />
        );
    }

    if (filter.type === "number") {
        return (
            <TextField
                type="number"
                labelHidden
                value={value}
                onChange={onChange}
            />
        );
    }

    if (filter.type === "date") {
        return (
            <TextField
                type="date"
                labelHidden
                value={value}
                onChange={onChange}
            />
        );
    }

    return (
        <TextField
            labelHidden
            value={value}
            onChange={onChange}
        />
    );
}
