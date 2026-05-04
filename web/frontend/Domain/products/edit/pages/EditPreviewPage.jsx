import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  Button,
  FormLayout,
  BlockStack,
  Box,
  Text,
  Banner,
  InlineStack,
  List,
  Badge,
  Icon,
  Modal,
  TextField,
  Divider,
  InlineGrid,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ClockIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { getFieldDefinition, InputType } from "../constants";
import { useFieldValidation } from "../hooks/useFiledValidation";
import { getValueValidationRules } from "../../../../utils/valueValidation";
import FieldSelector from "../components/FieldSelector";
import EditTypeSelector from "../components/EditTypeSelector";
import ValueInput from "../components/ValueInput";
import PreviewTable from "../components/PreviewTable";
import ScheduleEdit from "../components/ScheduleEdit";
import RecurringEditModal from "../components/RecurringEditModal";
import useDebounce from "../hooks/useDebounce";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";
import {
  selectFrozenTarget,
  selectFilters,
  selectSearch,
  setFilters,
} from "../../../../store/slices/productSlice";
import useProductSyncStatus from "../../../../hooks/useProductSyncStatus";

const FIELD_SAFETY_NOTES = {
  status: {
    tone: "warning",
    titleKey: "bulkEditSafetyStatusTitle",
    messageKey: "bulkEditSafetyStatusText",
    defaultTitle: "Status changes affect product visibility",
    defaultMessage: "Products may become visible or hidden immediately after the edit runs.",
  },
  handle: {
    tone: "warning",
    titleKey: "bulkEditSafetyHandleTitle",
    messageKey: "bulkEditSafetyHandleText",
    defaultTitle: "Changing product handle may break URLs",
    defaultMessage: "Confirm redirects are expected before applying this change.",
  },
  price: {
    tone: "warning",
    titleKey: "bulkEditSafetyPriceTitle",
    messageKey: "bulkEditSafetyPriceText",
    defaultTitle: "Price changes affect storefront and checkout",
    defaultMessage: "Review the current and new values carefully before running this edit.",
  },
  inventoryPolicy: {
    tone: "warning",
    titleKey: "bulkEditSafetyInventoryTitle",
    messageKey: "bulkEditSafetyInventoryText",
    defaultTitle: "Inventory changes can affect sell-through",
    defaultMessage: "Review inventory behavior before applying changes across variants.",
  },
  option1Values: {
    tone: "warning",
    titleKey: "bulkEditSafetyVariantsTitle",
    messageKey: "bulkEditSafetyVariantsText",
    defaultTitle: "Variant changes can affect options",
    defaultMessage: "Confirm option values and variant previews before applying this edit.",
  },
  option2Values: {
    tone: "warning",
    titleKey: "bulkEditSafetyVariantsTitle",
    messageKey: "bulkEditSafetyVariantsText",
    defaultTitle: "Variant changes can affect options",
    defaultMessage: "Confirm option values and variant previews before applying this edit.",
  },
  option3Values: {
    tone: "warning",
    titleKey: "bulkEditSafetyVariantsTitle",
    messageKey: "bulkEditSafetyVariantsText",
    defaultTitle: "Variant changes can affect options",
    defaultMessage: "Confirm option values and variant previews before applying this edit.",
  },
  metaTitle: {
    tone: "info",
    titleKey: "bulkEditSafetySeoTitleTitle",
    messageKey: "bulkEditSafetySeoTitleText",
    defaultTitle: "SEO title changes can affect search snippets",
    defaultMessage: "Keep titles accurate, readable, and aligned with the product title.",
  },
  tags: {
    tone: "info",
    titleKey: "bulkEditSafetyTagsTitle",
    messageKey: "bulkEditSafetyTagsText",
    defaultTitle: "Tag changes can affect automations and collections",
    defaultMessage: "Tags may drive store logic, customer segments, reports, or sales channels.",
  },
  collections: {
    tone: "warning",
    titleKey: "bulkEditSafetyCollectionsTitle",
    messageKey: "bulkEditSafetyCollectionsText",
    defaultTitle: "Collection changes can affect merchandising",
    defaultMessage: "Products may move in or out of storefront collection pages.",
  },
};

const RECIPE_TEMPLATES = [
  {
    key: "draftOutOfStock",
    labelKey: "bulkEditRecipeDraftOutOfStock",
    defaultLabel: "Draft out-of-stock",
    field: "status",
    actionValue: "Set status",
    value: "DRAFT",
    filters: [{ field: "inventory_q", operator: "=", value: "0" }],
  },
  {
    key: "addSaleTag",
    labelKey: "bulkEditRecipeAddSaleTag",
    defaultLabel: "Add sale tag",
    field: "tags",
    actionValue: "Add tag(s) to product",
    value: "sale",
  },
  {
    key: "increasePriceTen",
    labelKey: "bulkEditRecipeIncreasePriceTen",
    defaultLabel: "Increase prices 10%",
    field: "price",
    actionValue: "Increase by percent",
    value: "10",
  },
  {
    key: "removeVendorPrefix",
    labelKey: "bulkEditRecipeRemoveVendorPrefix",
    defaultLabel: "Remove vendor prefix",
    field: "title",
    actionValue: "Search/Replace",
    searchReplace: { search: "{{vendor}} - ", replace: "" },
  },
  {
    key: "setSeoTitle",
    labelKey: "bulkEditRecipeSetSeoTitle",
    defaultLabel: "SEO title from title",
    field: "metaTitle",
    actionValue: "Set text to value",
    value: "{{title}}",
  },
];

const SALE_PIPELINE_TEMPLATE = [
  {
    key: "addSaleTag",
    labelKey: "pipelineAddSaleTag",
    defaultLabel: 'Add tag "sale"',
    field: "tags",
    editOption: "Add tag(s) to product",
    value: "sale",
  },
  {
    key: "reducePrice",
    labelKey: "pipelineReducePrice",
    defaultLabel: "Reduce price by 10%",
    field: "price",
    editOption: "Decrease by percent",
    value: "10",
  },
  {
    key: "setCompareAtPrice",
    labelKey: "pipelineSetCompareAtPrice",
    defaultLabel: "Set compare-at price",
    field: "compareAtPrice",
    editOption: "Increase by percent",
    value: "10",
  },
];

const LARGE_OPERATION_THRESHOLD = 1000;
const ESTIMATED_PRODUCTS_PER_SECOND = 125;

function formatCount(value, language) {
  return Number(value || 0).toLocaleString(language);
}

function getEstimatedBulkEditSeconds(count) {
  const numericCount = Number(count || 0);
  if (numericCount <= 0) return 0;
  return Math.max(20, Math.ceil(numericCount / ESTIMATED_PRODUCTS_PER_SECOND));
}

function formatEstimatedBulkEditDuration(count, language) {
  const seconds = getEstimatedBulkEditSeconds(count);
  if (seconds <= 0) return "0s";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 2) return "~1 minute";
  return `~${minutes.toLocaleString(language)} minutes`;
}

function getImpactHeatmapRows({ selectedField, previewTotal, t }) {
  if (!selectedField || previewTotal <= 0) return [];

  const primaryLabel = t(`fieldLabels.${selectedField.value}`, {
    defaultValue: selectedField.label || selectedField.value,
  });
  const rows = [{ key: selectedField.value, label: primaryLabel, count: Number(previewTotal || 0) }];

  if (selectedField.value === "price") {
    rows.push({
      key: "compareAtPrice",
      label: t("fieldLabels.compareAtPrice", { defaultValue: "Compare at price" }),
      count: Math.round(previewTotal * 0.35),
    });
  }
  if (selectedField.value === "tags") {
    rows.push({
      key: "collections",
      label: t("fieldLabels.collections", { defaultValue: "Collections" }),
      count: Math.round(previewTotal * 0.45),
    });
  }
  if (selectedField.value === "vendor") {
    rows.push({
      key: "title",
      label: t("fieldLabels.title", { defaultValue: "Title" }),
      count: Math.round(previewTotal * 0.25),
    });
  }

  return rows;
}

export default function EditPreviewPage() {
  const filters = useSelector(selectFilters);
  const search = useSelector(selectSearch);
  const frozenTarget = useSelector(selectFrozenTarget);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { i18n, t } = useTranslation();
  const { isSyncInProgress } = useProductSyncStatus();
  const fetchWithAuth = useAuthenticatedFetch();

  const [selectedField, setSelectedField] = useState(getFieldDefinition("price"));
  const [editType, setEditType] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [supportValue, setSupportValue] = useState("");
  const [searchReplace, setSearchReplace] = useState({ search: "", replace: "" });
  const [locationValue, setLocationValue] = useState("");
  const [limitWarning, setLimitWarning] = useState(null);
  const [conflictWarning, setConflictWarning] = useState(null);
  const [operationRestriction, setOperationRestriction] = useState(null);
  const [guardrailConfirmText, setGuardrailConfirmText] = useState("");
  const [pendingGuardrailAction, setPendingGuardrailAction] = useState("");
  const [products, setProducts] = useState([]);
  const [isVariant, setIsVariant] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewMeta, setPreviewMeta] = useState({ mirrorBatchId: "", total: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalPages: 1 });
  const [modalState, setModalState] = useState({ scheduleEdit: false, recurringEdit: false });

  const targetSnapshotId =
    typeof searchParams.get("targetSnapshotId") === "string"
      ? searchParams.get("targetSnapshotId")
      : typeof location.state?.targetSnapshotId === "string"
      ? location.state.targetSnapshotId
      : typeof frozenTarget?.targetSnapshotId === "string"
      ? frozenTarget.targetSnapshotId
      : "";
  const frozenTargetCount = Number(location.state?.targetCount || frozenTarget?.count || 0);
  const targetPayload = location.state?.targetPayload || frozenTarget?.payload || null;
  const [previewTotal, setPreviewTotal] = useState(frozenTargetCount || 0);
  const debouncedValue = useDebounce(inputValue, 600);
  const debouncedSearchReplace = useDebounce(searchReplace, 600);

  useEffect(() => {
    if (!selectedField) return;
    const actions = selectedField.actions;
    if (actions?.length) {
      setEditType(actions[0]);
      setInputValue("");
      setSupportValue("");
      setSearchReplace({ search: "", replace: "" });
      setLocationValue("");
      setPagination((c) => ({ ...c, page: 1 }));
    }
  }, [selectedField]);

  const isPercentage = editType?.value?.toLowerCase().includes("percent");
  const isFixedValue =
    selectedField?.value === "price" &&
    editType?.value?.toLowerCase().includes("set") &&
    !isPercentage;

  const submitError = useFieldValidation(inputValue, getValueValidationRules(isPercentage, isFixedValue));
  const shouldHideEditTypeSelector =
    selectedField?.value === "status" || selectedField?.actions?.length <= 1;

  const effectiveFilters = useMemo(() => {
    const base = filters.filter((f) => f.field !== "search");
    if (!search?.trim()) return base;
    return [...base, { field: "search", operator: "contains", value: search.trim() }];
  }, [filters, search]);

  const buildPreviewRequestBody = useCallback(
    (page = pagination.page, limit = pagination.limit) => ({
      field: selectedField.value,
      editType: editType.value,
      editValue: debouncedValue,
      searchKey: debouncedSearchReplace.search,
      replaceText: debouncedSearchReplace.replace,
      location: locationValue,
      filterParams: targetSnapshotId ? [] : effectiveFilters,
      targetSnapshotId: targetSnapshotId || undefined,
      page,
      limit,
      supportValue,
    }),
    [selectedField, editType, debouncedValue, debouncedSearchReplace, locationValue,
     targetSnapshotId, effectiveFilters, pagination.page, pagination.limit, supportValue]
  );

  const applyRecipe = useCallback((recipe) => {
    const fieldDefinition = getFieldDefinition(recipe.field);
    const action = fieldDefinition?.actions?.find((a) => a.value === recipe.actionValue);
    if (!fieldDefinition || !action) return;
    setSelectedField(fieldDefinition);
    setEditType(action);
    setInputValue(recipe.value || "");
    setSupportValue("");
    setLocationValue("");
    setSearchReplace(recipe.searchReplace || { search: "", replace: "" });
    if (Array.isArray(recipe.filters)) dispatch(setFilters(recipe.filters));
    setPagination((c) => ({ ...c, page: 1 }));
    setConflictWarning(null);
  }, [dispatch]);

  useEffect(() => {
    const recipeKey = location.state?.recipeKey;
    if (!recipeKey) return;
    const recipe = RECIPE_TEMPLATES.find((r) => r.key === recipeKey);
    if (recipe) applyRecipe(recipe);
  }, [applyRecipe, location.state?.recipeKey]);

  const fetchPreview = useCallback(async () => {
    if (!editType || !selectedField) return;
    const validOps = selectedField.actions?.map((a) => a.value) || [];
    if (!validOps.includes(editType.value)) return;
    if (
      editType.inputType === InputType.SEARCH_REPLACE &&
      !debouncedSearchReplace.search &&
      !debouncedSearchReplace.replace
    ) return;

    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/products/edit-preview?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPreviewRequestBody()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message);
      setProducts(json.data.preview);
      setPagination(json.data.pagination);
      setIsVariant(json.data.isVariant);
      setPreviewTotal(json.data.pagination?.total || 0);
      setPreviewMeta({
        mirrorBatchId: json.data?.mirrorBatchId || "",
        total: Number(json.data?.pagination?.total || 0),
      });
      setConflictWarning(null);
    } catch (err) {
      toast.error(err.message || "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [editType, selectedField, debouncedValue, debouncedSearchReplace, locationValue,
      effectiveFilters, targetSnapshotId, pagination.page, pagination.limit,
      supportValue, fetchWithAuth, i18n.language, buildPreviewRequestBody]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  const canRunEdit = useMemo(() => {
    if (!editType || !selectedField) return false;
    switch (editType.inputType) {
      case InputType.SEARCH_REPLACE: return Boolean(searchReplace?.search?.trim());
      case InputType.CHOICE_LIST:
      case InputType.API_AUTOCOMPLETE:
      case InputType.LOCATION_SELECT: return Boolean(inputValue);
      case InputType.SINGLE:
      case InputType.NONE: return true;
      default: return Boolean(inputValue?.toString().trim());
    }
  }, [editType, inputValue, searchReplace?.search, selectedField]);

  const isAllProductsOperation = useMemo(() => {
    if (previewTotal <= 0) return false;
    if (targetSnapshotId) {
      if (!targetPayload || targetPayload.mode !== "query") return false;
      const hasFilters = Array.isArray(targetPayload.filters) ? targetPayload.filters.length > 0 : false;
      const hasSearch = Boolean(String(targetPayload.search || "").trim());
      const hasExcluded = Array.isArray(targetPayload.excludedIds) ? targetPayload.excludedIds.length > 0 : false;
      return !hasFilters && !hasSearch && !hasExcluded;
    }
    return effectiveFilters.length === 0 && !search?.trim();
  }, [effectiveFilters.length, previewTotal, search, targetPayload, targetSnapshotId]);

  const openAllProductsGuardrail = useCallback((action) => {
    setGuardrailConfirmText("");
    setPendingGuardrailAction(action);
  }, []);

  const closeAllProductsGuardrail = useCallback(() => {
    setGuardrailConfirmText("");
    setPendingGuardrailAction("");
  }, []);

  const handleRunEdit = async ({ confirmedAllProducts = false } = {}) => {
    if (isSyncInProgress || submitError || !editType || !canRunEdit) return;
    if (editType?.inputType === InputType.SEARCH_REPLACE && !searchReplace.search) {
      toast.error(t("bulkEditSearchReplaceSearchRequired"));
      return;
    }
    setSubmitting(true);
    setLimitWarning(null);
    setConflictWarning(null);
    setOperationRestriction(null);
    try {
      const preflightRes = await fetchWithAuth(`/api/products/edit-preview?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPreviewRequestBody(1, 1)),
      });
      const preflightJson = await preflightRes.json();
      if (preflightRes.ok) {
        const nextTotal = Number(preflightJson?.data?.pagination?.total || 0);
        const nextMirrorBatchId = preflightJson?.data?.mirrorBatchId || "";
        const countDelta = Math.abs(nextTotal - Number(previewMeta.total || 0));
        const mirrorChanged = previewMeta.mirrorBatchId && nextMirrorBatchId && previewMeta.mirrorBatchId !== nextMirrorBatchId;
        if (mirrorChanged || countDelta > 0) { setConflictWarning({ count: countDelta }); return; }
      }
      const res = await fetchWithAuth(`/api/products/update?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editedField: selectedField.value,
          editedType: editType.value,
          value: debouncedValue,
          searchKey: debouncedSearchReplace.search,
          replaceText: debouncedSearchReplace.replace,
          location: locationValue,
          filterParams: targetSnapshotId ? [] : effectiveFilters,
          targetSnapshotId: targetSnapshotId || undefined,
          supportValue,
          allProductsConfirmation: confirmedAllProducts ? "CONFIRM" : "",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409 && json.error) {
          setOperationRestriction({ code: json.error, message: json.message || "Bulk editing is disabled right now." });
          toast.error(json.message || "Bulk editing is disabled right now.", { duration: 6000 });
          return;
        }
        if (res.status === 400 && json.message?.toLowerCase().includes("plan")) {
          setLimitWarning(json.message);
          toast.error(json.message, { duration: 6000 });
        } else {
          toast.error(json.message || "Failed to update products");
        }
        return;
      }
      toast.success("Bulk edit started");
      navigate(`/editDetails/${json.id}`);
    } catch (err) {
      toast.error(err.message || "Failed to update products");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunPipeline = async ({ confirmedAllProducts = false } = {}) => {
    if (isSyncInProgress) return;
    if (previewTotal <= 0) { toast.error(t("noProductsMatch")); return; }
    setSubmitting(true);
    setLimitWarning(null);
    setConflictWarning(null);
    setOperationRestriction(null);
    try {
      const preflightRes = await fetchWithAuth(`/api/products/edit-preview?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "tags", editType: "Add tag(s) to product", editValue: "sale",
          filterParams: targetSnapshotId ? [] : effectiveFilters,
          targetSnapshotId: targetSnapshotId || undefined,
          page: 1, limit: 1,
        }),
      });
      const preflightJson = await preflightRes.json();
      if (preflightRes.ok) {
        const nextTotal = Number(preflightJson?.data?.pagination?.total || 0);
        const nextMirrorBatchId = preflightJson?.data?.mirrorBatchId || "";
        const countDelta = Math.abs(nextTotal - Number(previewMeta.total || 0));
        const mirrorChanged = previewMeta.mirrorBatchId && nextMirrorBatchId && previewMeta.mirrorBatchId !== nextMirrorBatchId;
        if (mirrorChanged || countDelta > 0) { setConflictWarning({ count: countDelta }); return; }
      }
      const [firstRule] = SALE_PIPELINE_TEMPLATE;
      const res = await fetchWithAuth(`/api/products/update?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editedField: firstRule.field,
          editedType: firstRule.editOption,
          value: firstRule.value,
          rules: SALE_PIPELINE_TEMPLATE.map((s) => ({ field: s.field, editOption: s.editOption, value: s.value })),
          title: t("pipelineSaleTitle", { defaultValue: "Sale pipeline" }),
          filterParams: targetSnapshotId ? [] : effectiveFilters,
          targetSnapshotId: targetSnapshotId || undefined,
          allProductsConfirmation: confirmedAllProducts ? "CONFIRM" : "",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409 && json.error) {
          setOperationRestriction({ code: json.error, message: json.message || "Bulk editing is disabled right now." });
          toast.error(json.message || "Bulk editing is disabled right now.", { duration: 6000 });
          return;
        }
        if (res.status === 400 && json.message?.toLowerCase().includes("plan")) {
          setLimitWarning(json.message);
          toast.error(json.message, { duration: 6000 });
        } else {
          toast.error(json.message || "Failed to run pipeline");
        }
        return;
      }
      toast.success(t("pipelineStarted", { defaultValue: "Pipeline started" }));
      navigate(`/editDetails/${json.id}`);
    } catch (err) {
      toast.error(err.message || "Failed to run pipeline");
    } finally {
      setSubmitting(false);
    }
  };

  const requestRunEdit = useCallback(() => {
    if (isAllProductsOperation) { openAllProductsGuardrail("edit"); return; }
    handleRunEdit();
  }, [handleRunEdit, isAllProductsOperation, openAllProductsGuardrail]);

  const requestRunPipeline = useCallback(() => {
    if (isAllProductsOperation) { openAllProductsGuardrail("pipeline"); return; }
    handleRunPipeline();
  }, [handleRunPipeline, isAllProductsOperation, openAllProductsGuardrail]);

  const runPendingGuardrailAction = useCallback(() => {
    if (guardrailConfirmText !== "CONFIRM") return;
    const action = pendingGuardrailAction;
    closeAllProductsGuardrail();
    if (action === "pipeline") { handleRunPipeline({ confirmedAllProducts: true }); return; }
    handleRunEdit({ confirmedAllProducts: true });
  }, [closeAllProductsGuardrail, guardrailConfirmText, handleRunEdit, handleRunPipeline, pendingGuardrailAction]);

  const editGuarantees = [
    t("bulkEditGuaranteeUndo", { defaultValue: "Undo available for this edit" }),
    t("bulkEditGuaranteeSnapshot", { defaultValue: "Snapshot saved before running" }),
    t("bulkEditGuaranteeFrozen", { defaultValue: "Affected products frozen during edit" }),
    t("bulkEditGuaranteeSafeMode", { defaultValue: "Safe mode enabled" }),
    t("bulkEditGuaranteeOptimizedBatches", { defaultValue: "Processing in optimized batches" }),
  ];

  const safetyNote = FIELD_SAFETY_NOTES[selectedField?.value];
  const estimatedDuration = formatEstimatedBulkEditDuration(previewTotal, i18n.language);
  const showImpactWarning = previewTotal > 0 && (previewTotal >= LARGE_OPERATION_THRESHOLD || Boolean(safetyNote));
  const impactHeatmapRows = getImpactHeatmapRows({ selectedField, previewTotal, t });

  const conflictTitle = conflictWarning?.count
    ? t("bulkEditConflictTitle", {
        count: conflictWarning.count,
        defaultValue: `${conflictWarning.count} products changed in Shopify after your preview.`,
      })
    : t("bulkEditConflictTitleUnknown", { defaultValue: "Products changed in Shopify after your preview." });

  return (
    <Page
      fullWidth
      title={t("ConfigureModifications", { defaultValue: "Configure bulk edit" })}
      subtitle={
        previewTotal > 0
          ? t("editPageSubtitle", {
              count: formatCount(previewTotal, i18n.language),
              defaultValue: `${formatCount(previewTotal, i18n.language)} products will be affected`,
            })
          : undefined
      }
      backAction={{
        content: t("back", { defaultValue: "Back" }),
        icon: ChevronLeftIcon,
        onAction: () => navigate("/products"),
      }}
      primaryAction={{
        content: submitting ? t("Running", { defaultValue: "Running…" }) : t("RunEdit", { defaultValue: "Run edit" }),
        onAction: requestRunEdit,
        loading: submitting,
        disabled: isSyncInProgress || Boolean(submitError) || !canRunEdit,
      }}
      secondaryActions={[
        {
          content: t("ScheduleEdit", { defaultValue: "Schedule" }),
          icon: ClockIcon,
          onAction: () => setModalState((c) => ({ ...c, scheduleEdit: true })),
          disabled: isSyncInProgress,
        },
        {
          content: t("RecurringEdit", { defaultValue: "Recurring" }),
          icon: RefreshIcon,
          onAction: () => setModalState((c) => ({ ...c, recurringEdit: true })),
          disabled: isSyncInProgress,
        },
      ]}
    >
      <BlockStack gap="600">
        {/* Global banners */}
        {isSyncInProgress && (
          <Banner tone="info" title={t("syncInProgress", { defaultValue: "Sync in progress" })}>
            <Text as="p">{t("bulkEditSyncBlockingMessage")}</Text>
          </Banner>
        )}
        {limitWarning && (
          <Banner
            tone="warning"
            title={t("planLimitReached", { defaultValue: "Plan limit reached" })}
            onDismiss={() => setLimitWarning(null)}
            action={{ content: t("upgradePlan", { defaultValue: "Upgrade plan" }), onAction: () => navigate("/pricing") }}
          >
            <Text as="p">{limitWarning}</Text>
          </Banner>
        )}
        {conflictWarning && (
          <Banner
            tone="warning"
            title={conflictTitle}
            action={{ content: t("bulkEditConflictRefresh", { defaultValue: "Refresh preview" }), onAction: fetchPreview }}
            onDismiss={() => setConflictWarning(null)}
          >
            <Text as="p">{t("bulkEditConflictText", { defaultValue: "Refresh preview before applying." })}</Text>
          </Banner>
        )}
        {operationRestriction && (
          <Banner
            tone="warning"
            title={t("bulkEditDisabled", { defaultValue: "Bulk editing disabled" })}
            onDismiss={() => setOperationRestriction(null)}
          >
            <Text as="p">{operationRestriction.message}</Text>
          </Banner>
        )}

        {/* Main two-column layout */}
        <Layout>
          {/* Left column — edit configuration */}
          <Layout.Section>
            <BlockStack gap="500">
              {/* Edit setup card */}
              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {t("bulkEditSetupTitle", { defaultValue: "Edit configuration" })}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("bulkEditSetupText", { defaultValue: "Choose a field and define how it should be changed across matching products." })}
                    </Text>
                  </BlockStack>

                  <Divider />

                  <FormLayout>
                    <FormLayout.Group condensed>
                      <FieldSelector
                        selectedField={selectedField}
                        onFieldChange={setSelectedField}
                      />
                      {!shouldHideEditTypeSelector && (
                        <EditTypeSelector
                          selectedField={selectedField}
                          editType={editType}
                          onEditTypeChange={setEditType}
                        />
                      )}
                    </FormLayout.Group>

                    <ValueInput
                      selectedField={selectedField}
                      editType={editType}
                      value={inputValue}
                      onChange={setInputValue}
                      searchReplace={searchReplace}
                      onSearchReplaceChange={setSearchReplace}
                      locationValue={locationValue}
                      onLocationChange={setLocationValue}
                      setSupportValue={setSupportValue}
                    />
                  </FormLayout>

                  {safetyNote && (
                    <Banner
                      tone={safetyNote.tone}
                      title={t(safetyNote.titleKey, { defaultValue: safetyNote.defaultTitle })}
                    >
                      <Text as="p">{t(safetyNote.messageKey, { defaultValue: safetyNote.defaultMessage })}</Text>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              {/* Recipe templates */}
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">
                      {t("bulkEditRecipesTitle", { defaultValue: "Quick recipes" })}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("bulkEditRecipesText", { defaultValue: "Start from a common bulk edit pattern and adjust before running." })}
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200" wrap>
                    {RECIPE_TEMPLATES.map((recipe) => (
                      <Button key={recipe.key} size="slim" onClick={() => applyRecipe(recipe)}>
                        {t(recipe.labelKey, { defaultValue: recipe.defaultLabel })}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Pipeline card */}
              {/* <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {t("pipelineTitle", { defaultValue: "Sale pipeline" })}
                      </Text>
                      <Badge tone="info">
                        {t("pipelineStepCount", {
                          count: SALE_PIPELINE_TEMPLATE.length,
                          defaultValue: `${SALE_PIPELINE_TEMPLATE.length} steps`,
                        })}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("pipelineText", { defaultValue: "Run multiple edit operations against the same frozen target in sequence." })}
                    </Text>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    {SALE_PIPELINE_TEMPLATE.map((step, index) => (
                      <InlineStack key={step.key} gap="300" blockAlign="center" wrap={false}>
                        <Box
                          minWidth="24px"
                          width="24px"
                          paddingBlock="050"
                          background="bg-surface-secondary"
                          borderRadius="full"
                        >
                          <Text as="span" variant="bodySm" fontWeight="semibold" alignment="center">
                            {index + 1}
                          </Text>
                        </Box>
                        <Text as="p" variant="bodyMd">
                          {t(step.labelKey, { defaultValue: step.defaultLabel })}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>

                  <Box paddingBlockStart="100">
                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        onClick={requestRunPipeline}
                        loading={submitting && pendingGuardrailAction !== "edit"}
                        disabled={isSyncInProgress || previewTotal <= 0}
                      >
                        {t("runPipeline", { defaultValue: "Run pipeline" })}
                      </Button>
                    </InlineStack>
                  </Box>
                </BlockStack>
              </Card> */}
            </BlockStack>
          </Layout.Section>

          {/* Right column — summary sidebar */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                {/* Count summary */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    {t("bulkEditPreviewSummaryTitle", { defaultValue: "Edit summary" })}
                  </Text>

                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Badge
                        tone={previewTotal > 0 ? "info" : "enabled"}
                        size="large"
                      >
                        {formatCount(previewTotal, i18n.language)}
                      </Badge>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {t("bulkEditMatchingProductsLabel", { defaultValue: "matching products" })}
                        </Text>
                        {previewTotal > 0 && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("bulkEditEstimatedTime", {
                              duration: estimatedDuration,
                              defaultValue: `Est. ${estimatedDuration}`,
                            })}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                  </Box>

                  <Text as="p" variant="bodySm" tone="subdued">
                    {loading
                      ? t("loadingProductsPreview", { defaultValue: "Loading preview…" })
                      : previewTotal > 0
                      ? t("productsReadyToEdit", { defaultValue: "products ready to edit" })
                      : t("noProductsMatch", { defaultValue: "No products match your current filters." })}
                  </Text>
                </BlockStack>

                {/* Impact warning */}
                {showImpactWarning && (
                  <Banner
                    tone="warning"
                    title={t("bulkEditImpactWarningTitle", {
                      count: formatCount(previewTotal, i18n.language),
                      defaultValue: `This will affect ${formatCount(previewTotal, i18n.language)} products`,
                    })}
                  >
                    <List type="bullet">
                      <List.Item>
                        {t("bulkEditImpactWarningTime", { defaultValue: "Large operations may take several minutes" })}
                      </List.Item>
                      <List.Item>
                        {t("bulkEditImpactWarningStorefront", { defaultValue: "Changes may impact storefront immediately" })}
                      </List.Item>
                    </List>
                  </Banner>
                )}

                {/* Impact heatmap */}
                {impactHeatmapRows.length > 0 && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("bulkEditSimulationHeatmapTitle", { defaultValue: "Fields affected" })}
                      </Text>
                      <BlockStack gap="250">
                        {impactHeatmapRows.map((row) => {
                          const width = Math.max(8, Math.round((row.count / Math.max(previewTotal, 1)) * 100));
                          return (
                            <BlockStack key={row.key} gap="100">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {row.label}
                                </Text>
                                <Text as="span" variant="bodySm" fontWeight="medium">
                                  {row.count.toLocaleString()}
                                </Text>
                              </InlineStack>
                              <div
                                aria-hidden="true"
                                style={{
                                  width: "100%",
                                  height: "6px",
                                  background: "var(--p-color-bg-fill-tertiary, #e4e5e7)",
                                  borderRadius: "999px",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${width}%`,
                                    height: "100%",
                                    background: "var(--p-color-bg-fill-success, #008060)",
                                    borderRadius: "999px",
                                    transition: "width 0.4s ease",
                                  }}
                                />
                              </div>
                            </BlockStack>
                          );
                        })}
                      </BlockStack>
                    </BlockStack>
                  </>
                )}

                {/* Guarantees */}
                <Divider />
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                    {t("bulkEditGuaranteesTitle", { defaultValue: "What's protected" })}
                  </Text>
                  {editGuarantees.map((guarantee) => (
                    <InlineStack key={guarantee} gap="200" blockAlign="center" wrap={false}>
                      <Box flexShrink="0">
                        <Icon source={CheckCircleIcon} tone="success" />
                      </Box>
                      <Text as="span" variant="bodySm">
                        {guarantee}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Preview table — full width below */}
        <PreviewTable
          loading={loading}
          products={products}
          pagination={pagination}
          isVariant={isVariant}
          onPageChange={(page) => setPagination((c) => ({ ...c, page }))}
          field={selectedField.value}
        />
      </BlockStack>

      {/* Modals */}
      {modalState.scheduleEdit && (
        <ScheduleEdit
          show
          onHide={() => setModalState((c) => ({ ...c, scheduleEdit: false }))}
          count={previewTotal}
          editedField={selectedField.value}
          editedBy={editType?.value}
          value={debouncedValue}
          searchKey={debouncedSearchReplace.search}
          replaceText={debouncedSearchReplace.replace}
          location={locationValue}
          filters={effectiveFilters}
          targetSnapshotId={targetSnapshotId}
          supportValue={supportValue}
        />
      )}
      {modalState.recurringEdit && (
        <RecurringEditModal
          show
          onHide={() => setModalState((c) => ({ ...c, recurringEdit: false }))}
          count={previewTotal}
          editedField={selectedField.value}
          editedBy={editType?.value}
          value={debouncedValue}
          searchKey={debouncedSearchReplace.search}
          replaceText={debouncedSearchReplace.replace}
          location={locationValue}
          filters={effectiveFilters}
          targetSnapshotId={targetSnapshotId}
          supportValue={supportValue}
        />
      )}

      {/* All-products guardrail modal */}
      <Modal
        open={Boolean(pendingGuardrailAction)}
        onClose={closeAllProductsGuardrail}
        title={t("allProductsGuardrailTitle", { defaultValue: "You're about to change ALL products" })}
        primaryAction={{
          content: pendingGuardrailAction === "pipeline"
            ? t("runPipeline", { defaultValue: "Run pipeline" })
            : t("RunEdit", { defaultValue: "Run edit" }),
          destructive: true,
          disabled: guardrailConfirmText !== "CONFIRM",
          loading: submitting,
          onAction: runPendingGuardrailAction,
        }}
        secondaryActions={[
          {
            content: t("commonCancelButton", { defaultValue: "Cancel" }),
            onAction: closeAllProductsGuardrail,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="critical">
              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">
                  {t("allProductsGuardrailWarning", {
                    count: formatCount(previewTotal, i18n.language),
                    defaultValue: `This operation will affect ${formatCount(previewTotal, i18n.language)} products.`,
                  })}
                </Text>
                <Text as="p" tone="subdued">
                  {t("allProductsGuardrailText", {
                    defaultValue: 'Type "CONFIRM" to proceed with changing every product in this target.',
                  })}
                </Text>
              </BlockStack>
            </Banner>
            <TextField
              label={t("allProductsGuardrailInputLabel", { defaultValue: 'Type "CONFIRM" to proceed' })}
              value={guardrailConfirmText}
              onChange={setGuardrailConfirmText}
              autoComplete="off"
              placeholder="CONFIRM"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}