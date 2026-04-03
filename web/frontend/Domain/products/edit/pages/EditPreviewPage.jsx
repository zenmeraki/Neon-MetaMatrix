import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  BlockStack,
  Box,
  Text,
  Banner,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { ChevronLeftIcon } from "@shopify/polaris-icons";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
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
import { selectFilters, selectProductCount } from "../../../../store/slices/productSlice";
import useProductSyncStatus from "../../../../hooks/useProductSyncStatus";

export default function EditPreviewPage() {
  const filters = useSelector(selectFilters);
  const count = useSelector(selectProductCount);
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const { isSyncInProgress } = useProductSyncStatus();

  const [selectedField, setSelectedField] = useState(getFieldDefinition("price"));
  const [editType, setEditType] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [supportValue, setSupportValue] = useState("");
  const [searchReplace, setSearchReplace] = useState({
    search: "",
    replace: "",
  });
  const [locationValue, setLocationValue] = useState("");
  const [limitWarning, setLimitWarning] = useState(null);
  const [products, setProducts] = useState([]);
  const [isVariant, setIsVariant] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalPages: 1,
  });
  const [modalState, setModalState] = useState({
    scheduleEdit: false,
    recurringEdit: false,
  });

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
      setPagination((current) => ({ ...current, page: 1 }));
    }
  }, [selectedField]);

  const isPercentage = editType?.value?.toLowerCase().includes("percent");
  const isFixedValue =
    selectedField?.value === "price" &&
    editType?.value?.toLowerCase().includes("set") &&
    !isPercentage;

  const submitError = useFieldValidation(
    inputValue,
    getValueValidationRules(isPercentage, isFixedValue),
  );

  const shouldHideEditTypeSelector =
    selectedField?.value === "status" || selectedField?.actions?.length <= 1;

  const fetchPreview = useCallback(async () => {
    if (!editType || !selectedField) return;

    if (
      editType.inputType === InputType.SEARCH_REPLACE &&
      !debouncedSearchReplace.search &&
      !debouncedSearchReplace.replace
    ) {
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/products/edit-preview?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: selectedField.value,
          editType: editType.value,
          editValue: debouncedValue,
          searchKey: debouncedSearchReplace.search,
          replaceText: debouncedSearchReplace.replace,
          location: locationValue,
          filterParams: filters,
          page: pagination.page,
          limit: pagination.limit,
          supportValue,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.message);

      setProducts(json.data.preview);
      setPagination(json.data.pagination);
      setIsVariant(json.data.isVariant);
    } catch (err) {
      toast.error(err.message || "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [
    editType,
    selectedField,
    debouncedValue,
    debouncedSearchReplace,
    locationValue,
    filters,
    pagination.page,
    pagination.limit,
    supportValue,
    i18n.language,
  ]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const canRunEdit = useMemo(() => {
    if (!editType || !selectedField) return false;

    switch (editType.inputType) {
      case InputType.SEARCH_REPLACE:
        return Boolean(searchReplace?.search?.trim());
      case InputType.CHOICE_LIST:
      case InputType.API_AUTOCOMPLETE:
      case InputType.LOCATION_SELECT:
        return Boolean(inputValue);
      case InputType.SINGLE:
      case InputType.NONE:
        return true;
      default:
        return Boolean(inputValue?.toString().trim());
    }
  }, [editType, inputValue, searchReplace?.search, selectedField]);

  const handleRunEdit = async () => {
    if (isSyncInProgress) {
      return;
    }

    if (submitError) {
      toast.error(submitError);
      return;
    }

    if (editType?.inputType === InputType.SEARCH_REPLACE && !searchReplace.search) {
      toast.error("Please enter a search value");
      return;
    }

    if (!editType || !canRunEdit) return;

    setSubmitting(true);
    setLimitWarning(null);

    try {
      const res = await fetch(`/api/products/update?lang=${i18n.language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editedField: selectedField.value,
          editedType: editType.value,
          value: debouncedValue,
          searchKey: debouncedSearchReplace.search,
          replaceText: debouncedSearchReplace.replace,
          location: locationValue,
          filterParams: filters,
          supportValue,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
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

  const summaryText = useMemo(() => {
    if (loading) {
      return t("loadingProductsPreview");
    }

    if (count > 0) {
      return `${count} ${t("productsReadyToEdit")}`;
    }

    return t("noProductsMatch");
  }, [count, loading, t]);

  return (
    <Page
      fullWidth
      title={t("ConfigureModifications")}
      backAction={{
        content: "Back",
        icon: ChevronLeftIcon,
        onAction: () => navigate("/products"),
      }}
      primaryAction={{
        content: submitting ? t("Running") : t("RunEdit"),
        onAction: handleRunEdit,
        loading: submitting,
        disabled: isSyncInProgress || Boolean(submitError) || !canRunEdit,
      }}
      secondaryActions={[
        {
          content: t("ScheduleEdit"),
          onAction: () => setModalState((current) => ({ ...current, scheduleEdit: true })),
          disabled: isSyncInProgress,
        },
        {
          content: "Recurring Edit",
          onAction: () => setModalState((current) => ({ ...current, recurringEdit: true })),
          disabled: isSyncInProgress,
        },
      ]}
    >
      <Layout>
        {isSyncInProgress && (
          <Layout.Section>
            <Banner tone="info" title="Sync in progress">
              <p>
                Product sync is still running. Edit, schedule, and recurring actions are temporarily disabled until the mirror is ready.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          {limitWarning && (
            <Box paddingBlockEnd="300">
              <Banner
                tone="warning"
                title="Plan limit reached"
                onDismiss={() => setLimitWarning(null)}
                action={{
                  content: "Upgrade plan",
                  onAction: () => navigate("/pricing"),
                }}
              >
                <p>{limitWarning}</p>
              </Banner>
            </Box>
          )}

          <Card>
            <Box padding="500">
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Edit setup
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Choose a field, set the transformation, and review the exact preview before you run anything.
                  </Text>
                </BlockStack>

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
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <Box padding="500">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Preview summary
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={count > 0 ? "info" : "attention"}>{count || 0}</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Matching products
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {summaryText}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  The preview refreshes from your current filter set and uses the same targeting basis as the edit run.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <PreviewTable
            loading={loading}
            products={products}
            pagination={pagination}
            isVariant={isVariant}
            onPageChange={(page) => setPagination((current) => ({ ...current, page }))}
            field={selectedField.value}
          />
        </Layout.Section>
      </Layout>

      {modalState.scheduleEdit && (
        <ScheduleEdit
          show
          onHide={() => setModalState((current) => ({ ...current, scheduleEdit: false }))}
          count={count}
          editedField={selectedField.value}
          editedBy={editType?.value}
          value={debouncedValue}
          searchKey={debouncedSearchReplace.search}
          replaceText={debouncedSearchReplace.replace}
          location={locationValue}
          filters={filters}
          supportValue={supportValue}
        />
      )}

      {modalState.recurringEdit && (
        <RecurringEditModal
          show
          onHide={() => setModalState((current) => ({ ...current, recurringEdit: false }))}
          count={count}
          editedField={selectedField.value}
          editedBy={editType?.value}
          value={debouncedValue}
          searchKey={debouncedSearchReplace.search}
          replaceText={debouncedSearchReplace.replace}
          location={locationValue}
          filters={filters}
          supportValue={supportValue}
        />
      )}
    </Page>
  );
}
