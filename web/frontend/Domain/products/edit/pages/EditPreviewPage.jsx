import React, { useState, useEffect, useCallback } from "react";
import { Page, Layout, Card, FormLayout, BlockStack, Box, Text, Banner} from "@shopify/polaris";
import { ChevronLeftIcon } from "@shopify/polaris-icons";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

// Config
import { getFieldDefinition, InputType } from "../constants";

// Validation
import { useFieldValidation } from "../hooks/useFiledValidation";
import { getValueValidationRules } from "../../../../utils/valueValidation";

// Components
import FieldSelector from "../components/FieldSelector";
import EditTypeSelector from "../components/EditTypeSelector";
import ValueInput from "../components/ValueInput";
import PreviewTable from "../components/PreviewTable";
import ScheduleEdit from "../components/ScheduleEdit";
import useDebounce from "../hooks/useDebounce";
import { selectFilters, selectProductCount } from "../../../../store/slices/productSlice";


export default function EditPreviewPage() {

  const filters = useSelector(selectFilters);
  const count = useSelector(selectProductCount);

  console.log("Received filters:", filters);
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();

  // =========================
  // STATE
  // =========================
  const [selectedField, setSelectedField] = useState(
    getFieldDefinition("price"),
  );
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
  });

  // =========================
  // DEBOUNCED VALUES
  // =========================
  const debouncedValue = useDebounce(inputValue, 600);
  const debouncedSearchReplace = useDebounce(searchReplace, 600);

  // =========================
  // RESET STATE ON FIELD CHANGE
  // =========================
  useEffect(() => {
    if (!selectedField) return;

    const actions = selectedField.actions;
    if (actions?.length) {
      setEditType(actions[0]);

      // Reset ALL inputs
      setInputValue("");
      setSupportValue("");
      setSearchReplace({ search: "", replace: "" });
      setLocationValue("");

      // Reset pagination
      setPagination((p) => ({ ...p, page: 1 }));
    }
  }, [selectedField]);

  // =========================
  // EDIT CHARACTERISTICS
  // =========================
  const isPercentage = editType?.value?.toLowerCase().includes("percent");

  const isFixedValue =
    selectedField?.value === "price" &&
    editType?.value?.toLowerCase().includes("set") &&
    !isPercentage;

  // =========================
  // VALIDATION
  // =========================
  const submitError = useFieldValidation(
    inputValue,
    getValueValidationRules(isPercentage, isFixedValue),
  );

  const shouldHideEditTypeSelector =
    selectedField?.value === "status" || selectedField?.actions?.length <= 1;

  // =========================
  // FETCH PREVIEW
  // =========================
  const fetchPreview = useCallback(async () => {
    if (!editType || !selectedField) return;

    // Skip preview if search/replace is empty
    if (
      editType.inputType === InputType.SEARCH_REPLACE &&
      !debouncedSearchReplace.search &&
      !debouncedSearchReplace.replace
    ) {
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `/api/products/edit-preview?lang=${i18n.language}`,
        {
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
        },
      );

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

  // =========================
  // CAN RUN EDIT
  // =========================
  const canRunEdit = (() => {
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
  })();

  // =========================
  // RUN BULK EDIT
  // =========================
  const handleRunEdit = async () => {
    if (submitError) {
      toast.error(submitError);
      return;
    }

    if (
      editType?.inputType === InputType.SEARCH_REPLACE &&
      !searchReplace.search
    ) {
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
      if (res.status === 400 && json.message?.toLowerCase().includes('plan')) {
        // Show both toast and banner
        setLimitWarning(json.message);
        toast.error(json.message, { duration: 6000 });
      } else {
        toast.error(json.message || "Failed to update products");
      }
      return;
    }

      toast.success("Bulk edit started");
      navigate("/editDetails/" + json.id);

    } catch (err) {
      toast.error(err.message || "Failed to update products");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================
  // RENDER
  // =========================
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
        disabled: Boolean(submitError) || !canRunEdit,
      }}
      secondaryActions={[
        {
          content: t("ScheduleEdit"),
          onAction: () => setModalState((p) => ({ ...p, scheduleEdit: true })),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
             {limitWarning && (
            <Banner
              tone="warning"
              title="Plan limit reached"
              onDismiss={() => setLimitWarning(null)}
              action={{
                content: 'Upgrade Plan',
                onAction: () => navigate('/pricing'),
              }}
            >
              <p>{limitWarning}</p>
            </Banner>
          )}
            <Card>
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
            </Card>
            {/* Preview info text */}
            <Box paddingInline="200">
              {loading ? (
                <Text variant="bodySm" tone="subdued">
                  {t("loadingProductsPreview")}
                </Text>
              ) : count > 0 ? (
                <Text variant="bodySm" tone="subdued">
                  <strong>{count}</strong> {t("productsReadyToEdit")}
                </Text>
              ) : (
                <Text variant="bodySm" tone="subdued">
                  {t("noProductsMatch")}
                </Text>
              )}
            </Box>

            <PreviewTable
              loading={loading}
              products={products}
              pagination={pagination}
              isVariant={isVariant}
              onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
              field={selectedField.value}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* =========================
          SCHEDULE EDIT MODAL
         ========================= */}
      {modalState.scheduleEdit && (
        <ScheduleEdit
          show
          onHide={() => setModalState((p) => ({ ...p, scheduleEdit: false }))}
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
