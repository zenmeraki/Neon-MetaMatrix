import { useCallback, useEffect, useState } from "react";
import { clearFilters, setFilters, setSearch } from "../../../store/slices/productSlice";

const PRESET_VIEWS = [
  { id: "custom", name: "Custom", filters: [], search: "" },
  { id: "specific_products", name: "Specific products", filters: [], search: "" },
  {
    id: "compare_at_blank",
    name: "Compare-at Price is Blank",
    filters: [{ field: "compare_at_price", operator: "is empty", value: "" }],
    search: "",
  },
  {
    id: "no_images",
    name: "Doesn't have images",
    filters: [{ field: "no_images", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "duplicate_barcode",
    name: "Has Duplicate Barcode",
    filters: [{ field: "has_duplicate_barcode", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "duplicate_sku",
    name: "Has Duplicate SKU",
    filters: [{ field: "has_duplicate_sku", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "duplicate_title",
    name: "Has Duplicate Title",
    filters: [{ field: "has_duplicate_title", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "has_images",
    name: "Has Images",
    filters: [{ field: "has_images", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "no_collection",
    name: "Not in any Collection",
    filters: [{ field: "collection", operator: "is empty", value: "" }],
    search: "",
  },
  {
    id: "no_manual_collection",
    name: "Not in any Manual Collection",
    filters: [{ field: "not_in_manual_collection", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "price_lt_compare_at",
    name: "Price < Compare-at Price",
    filters: [{ field: "price_lt_compare_at_price", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "price_eq_compare_at",
    name: "Price = Compare-at Price",
    filters: [{ field: "price_eq_compare_at_price", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "price_gt_compare_at",
    name: "Price > Compare-at Price",
    filters: [{ field: "price_gt_compare_at_price", operator: "is", value: "true" }],
    search: "",
  },
  {
    id: "out_of_stock",
    name: "Product is completely out of stock",
    filters: [{ field: "inventory_q", operator: "=", value: "0" }],
    search: "",
  },
];

export function useProductSavedSegments({
  fetchWithAuth,
  dispatch,
  t,
  targetSort,
  filterState,
  search,
  hasActiveSegmentCriteria,
}) {
  const [savedSegments, setSavedSegments] = useState([]);
  const [selectedView, setSelectedView] = useState(0);
  const [segmentName, setSegmentName] = useState("");
  const [segmentNotice, setSegmentNotice] = useState("");

  const dismissSegmentNotice = useCallback(() => setSegmentNotice(""), []);

  const fetchSavedSegments = useCallback(async () => {
    const response = await fetchWithAuth("/api/products/saved-segments");
    const result = await response.json();

    if (response.ok && Array.isArray(result.data)) {
      setSavedSegments(result.data);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchSavedSegments();
  }, [fetchSavedSegments]);

  const persistSavedSegment = useCallback(
    async (segment) => {
      const response = await fetchWithAuth("/api/products/saved-segments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(segment),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || "SEGMENT_SAVE_FAILED");
      }

      await fetchSavedSegments();
      return result.data;
    },
    [fetchWithAuth, fetchSavedSegments]
  );

  const handleSaveCurrentSegment = useCallback(async () => {
    const name = segmentName.trim();
    if (!name || !hasActiveSegmentCriteria) return;

    try {
      await persistSavedSegment({
        name,
        filters: filterState.filter((filter) => filter.field !== "search"),
        search: search?.trim() || "",
        sort: targetSort,
        destinations: ["bulk_edit", "export", "scheduled_rule", "automatic_rule"],
      });

      setSelectedView(PRESET_VIEWS.length);
      setSegmentNotice(
        t("segmentSavedNotice", {
          name,
          defaultValue: `"${name}" saved for bulk edit, export, scheduled rules, and automatic rules.`,
        })
      );
    } catch (error) {
      setSegmentNotice(error.message || "Could not save segment.");
    }
  }, [
    filterState,
    hasActiveSegmentCriteria,
    persistSavedSegment,
    search,
    segmentName,
    t,
    targetSort,
  ]);

  const handleSavedViewSelect = useCallback(
    (index) => {
      setSelectedView(index);

      if (index < PRESET_VIEWS.length) {
        const preset = PRESET_VIEWS[index];
        dispatch(setFilters(preset?.filters || []));
        dispatch(setSearch(preset?.search || ""));
        setSegmentName(preset?.name || "");
        setSegmentNotice(
          t("segmentAppliedNotice", {
            name: preset?.name || "Preset",
            defaultValue: `"${preset?.name || "Preset"}" applied.`,
          })
        );
        return;
      }

      const segment = savedSegments[index - PRESET_VIEWS.length];
      if (!segment) return;

      dispatch(setFilters(segment.filters || []));
      dispatch(setSearch(segment.search || ""));
      setSegmentName(segment.name || "");
      setSegmentNotice(
        t("segmentAppliedNotice", {
          name: segment.name,
          defaultValue: `"${segment.name}" applied.`,
        })
      );
    },
    [dispatch, savedSegments, t]
  );

  return {
    presetViews: PRESET_VIEWS,
    savedSegments,
    selectedView,
    segmentName,
    segmentNotice,
    setSegmentName,
    handleSaveCurrentSegment,
    handleSavedViewSelect,
    dismissSegmentNotice,
    setSelectedView,
  };
}
