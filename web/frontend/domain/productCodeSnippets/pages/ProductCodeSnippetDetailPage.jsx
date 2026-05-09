import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import {
  archiveProductCodeSnippet,
  createProductCodeSnippet,
  getProductCodeSnippet,
  previewProductCodeSnippet,
  searchPreviewProducts,
  updateProductCodeSnippet,
  validateProductCodeSnippet,
} from "../services/productCodeSnippetService";

const EMPTY_SNIPPET = {
  title: "",
  status: "DRAFT",
  code: "",
};

function getStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "ARCHIVED":
      return "critical";
    default:
      return "attention";
  }
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export default function ProductCodeSnippetDetailPage({ snippetId = null }) {
  const navigate = useNavigate();
  const fetchFn = useAuthenticatedFetch();
  const isNew = !snippetId;

  const [formState, setFormState] = useState(EMPTY_SNIPPET);
  const [savedSnippet, setSavedSnippet] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pageError, setPageError] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [previewResult, setPreviewResult] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadSnippet = async () => {
      setLoading(true);
      setPageError("");

      try {
        const snippet = await getProductCodeSnippet(fetchFn, snippetId);
        if (!active) return;
        setSavedSnippet(snippet);
        setFormState({
          title: snippet.title || "",
          status: snippet.status || "DRAFT",
          code: snippet.code || "",
        });
      } catch (err) {
        if (active) {
          setPageError(err.message || "Failed to load snippet");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadSnippet();
    return () => {
      active = false;
    };
  }, [fetchFn, isNew, snippetId]);

  useEffect(() => {
    let active = true;

    const loadProducts = async () => {
      try {
        const products = await searchPreviewProducts(fetchFn, productSearch);
        if (!active) return;

        setProductOptions(
          products.map((product) => ({
            label: product.handle
              ? `${product.title} (${product.handle})`
              : product.title,
            value: product.id,
            product,
          })),
        );
      } catch (_err) {
        if (active) {
          setProductOptions([]);
        }
      }
    };

    loadProducts();
    return () => {
      active = false;
    };
  }, [fetchFn, productSearch]);

  const selectedProduct = useMemo(() => {
    const option = productOptions.find((item) => item.value === selectedProductId);
    return option?.product || previewResult?.product || null;
  }, [previewResult, productOptions, selectedProductId]);

  const isArchived = (savedSnippet?.status || formState.status) === "ARCHIVED";
  const isDirty = isNew
    ? Boolean(formState.title || formState.code)
    : Boolean(
        savedSnippet &&
        (savedSnippet.title !== formState.title ||
          savedSnippet.status !== formState.status ||
          savedSnippet.code !== formState.code),
      );

  const canSave = !isArchived && !saving && Boolean(formState.title.trim() && formState.code.trim());
  const canValidate = !isNew && !isDirty && !isArchived && !validating;
  const canPreview =
    !isNew &&
    !isDirty &&
    !isArchived &&
    Boolean(selectedProductId) &&
    !previewing;

  const supportedInputFields = [
    "title",
    "handle",
    "vendor",
    "productType",
    "status",
    "tags",
    "description",
    "categoryName",
    "totalInventory",
    "variants.price",
    "variants.compareAtPrice",
    "variants.sku",
    "variants.barcode",
    "variants.taxable",
    "variants.inventoryPolicy",
  ].join(", ");

  const supportedOutputFields = [
    "title",
    "handle",
    "vendor",
    "productType",
    "description",
    "metaTitle",
    "metaDescription",
    "status",
    "tags",
    "price",
    "compareAtPrice",
    "sku",
    "barcode",
    "taxable",
    "inventoryPolicy",
  ].join(", ");

  const handleFieldChange = (field) => (value) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
    setPageError("");
  };

  const handleSave = async () => {
    if (!canSave) return;

    setSaving(true);
    setPageError("");
    setValidationMessage("");

    try {
      const payload = {
        title: formState.title.trim(),
        status: formState.status,
        code: formState.code,
      };

      const snippet = isNew
        ? await createProductCodeSnippet(fetchFn, payload)
        : await updateProductCodeSnippet(fetchFn, snippetId, payload);

      setSavedSnippet(snippet);
      setFormState({
        title: snippet.title,
        status: snippet.status,
        code: snippet.code,
      });
      setValidationMessage("Snippet saved and validated successfully.");

      if (isNew) {
        navigate(`/product-code-snippets/${snippet.id}`, { replace: true });
      }
    } catch (err) {
      setPageError(err.message || "Failed to save snippet");
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!canValidate) return;

    setValidating(true);
    setPageError("");
    setValidationMessage("");

    try {
      const result = await validateProductCodeSnippet(fetchFn, snippetId);
      setSavedSnippet(result.snippet);
      if (result.validationStatus === "VALID") {
        setValidationMessage("Snippet validation passed.");
      } else {
        setPageError(result.error || "Snippet validation failed");
      }
    } catch (err) {
      setPageError(err.message || "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  const handlePreview = async () => {
    if (!canPreview) return;

    setPreviewing(true);
    setPageError("");

    try {
      const result = await previewProductCodeSnippet(fetchFn, snippetId, selectedProductId);
      setPreviewResult(result);
    } catch (err) {
      setPageError(err.message || "Preview failed");
      setPreviewResult(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleArchive = async () => {
    if (isNew || !savedSnippet) return;

    setSaving(true);
    setPageError("");

    try {
      await archiveProductCodeSnippet(fetchFn, savedSnippet.id);
      navigate("/product-code-snippets");
    } catch (err) {
      setPageError(err.message || "Failed to archive snippet");
    } finally {
      setSaving(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <>
      <Page
        fullWidth
        backAction={{
          content: "Back to snippets",
          onAction: () => navigate("/product-code-snippets"),
        }}
        title={isNew ? "New snippet" : savedSnippet?.title || "Snippet"}
        titleMetadata={
          <InlineStack gap="200">
            {!isNew && (
              <Badge tone={getStatusTone(savedSnippet?.status)}>
                {savedSnippet?.status}
              </Badge>
            )}
            {isDirty && <Badge tone="attention">Unsaved changes</Badge>}
          </InlineStack>
        }
        subtitle="Write safe product logic, validate it against the snippet DSL, and preview the normalized edit payload before using it anywhere else."
        primaryAction={{
          content: saving ? "Saving" : isNew ? "Save snippet" : "Save changes",
          onAction: handleSave,
          loading: saving,
          disabled: !canSave,
        }}
        secondaryActions={[
          {
            content: validating ? "Validating" : "Validate",
            onAction: handleValidate,
            disabled: !canValidate,
            loading: validating,
          },
          {
            content: previewing ? "Previewing" : "Run preview",
            onAction: handlePreview,
            disabled: !canPreview,
            loading: previewing,
          },
          ...(!isNew
            ? [
                {
                  content: "Archive",
                  destructive: true,
                  onAction: () => setShowDeleteModal(true),
                },
              ]
            : []),
        ]}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {loading ? (
                <Card>
                  <Box padding="400">
                    <BlockStack gap="300">
                      <SkeletonDisplayText size="small" />
                      <SkeletonBodyText lines={10} />
                    </BlockStack>
                  </Box>
                </Card>
              ) : (
                <>
                  {pageError && (
                    <Banner tone="critical" title="Snippet issue">
                      <p>{pageError}</p>
                    </Banner>
                  )}

                  {validationMessage && (
                    <Banner tone="success" title="Snippet ready">
                      <p>{validationMessage}</p>
                    </Banner>
                  )}

                  {isArchived && (
                    <Banner tone="warning" title="Archived snippet">
                      <p>This snippet is archived and read-only.</p>
                    </Banner>
                  )}

                  <Card>
                    <Box padding="400">
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingMd">
                              Snippet details
                            </Text>
                            <Text variant="bodySm" tone="subdued">
                              Give the snippet a clear name and keep it in draft until the preview looks right.
                            </Text>
                          </BlockStack>
                          <Badge tone={getStatusTone(formState.status)}>{formState.status}</Badge>
                        </InlineStack>

                        <TextField
                          label="Snippet title"
                          value={formState.title}
                          onChange={handleFieldChange("title")}
                          autoComplete="off"
                          disabled={isArchived}
                        />

                        <Select
                          label="Snippet status"
                          value={formState.status}
                          onChange={handleFieldChange("status")}
                          options={[
                            { label: "Draft", value: "DRAFT" },
                            { label: "Active", value: "ACTIVE" },
                          ]}
                          disabled={isArchived}
                        />
                      </BlockStack>
                    </Box>
                  </Card>

                  <Card>
                    <Box padding="400">
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <Text as="h2" variant="headingMd">
                            Snippet logic
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            Use the safe JSON snippet DSL with optional <code>when</code>, required <code>then</code>, and optional <code>else</code> objects.
                          </Text>
                        </BlockStack>

                        <TextField
                          label="Snippet code"
                          value={formState.code}
                          onChange={handleFieldChange("code")}
                          autoComplete="off"
                          multiline={18}
                          disabled={isArchived}
                        />
                      </BlockStack>
                    </Box>
                  </Card>

                  <Card>
                    <Box padding="400">
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">
                          Supported schema
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          Condition fields: {supportedInputFields}
                        </Text>
                        <Divider />
                        <Text variant="bodySm" tone="subdued">
                          Output fields: {supportedOutputFields}
                        </Text>
                        <Divider />
                        <Text variant="bodySm" tone="subdued">
                          Supported operators: equals, notEquals, contains, notContains, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, in, notIn, exists, isEmpty.
                        </Text>
                      </BlockStack>
                    </Box>
                  </Card>
                </>
              )}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Preview with a product
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Choose a real product from your mirror data, then run a non-mutating preview of the normalized output.
                    </Text>

                    <TextField
                      label="Find product"
                      value={productSearch}
                      onChange={setProductSearch}
                      placeholder="Search by title, handle, or vendor"
                      autoComplete="off"
                    />

                    <Select
                      label="Preview product"
                      value={selectedProductId}
                      onChange={setSelectedProductId}
                      options={[
                        { label: productOptions.length ? "Select a product" : "No products found", value: "" },
                        ...productOptions.map((item) => ({
                          label: item.label,
                          value: item.value,
                        })),
                      ]}
                    />

                    <Button
                      variant="primary"
                      onClick={handlePreview}
                      disabled={!canPreview}
                    >
                      Run preview
                    </Button>

                    {isNew && (
                      <Text variant="bodySm" tone="subdued">
                        Save the snippet once to enable validation and preview.
                      </Text>
                    )}
                    {!isNew && isDirty && (
                      <Text variant="bodySm" tone="subdued">
                        Save your latest edits before running preview.
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </Card>

              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Selected product
                    </Text>

                    {!selectedProduct ? (
                      <EmptyState
                        heading="No product selected"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Choose a product to unlock preview testing.</p>
                      </EmptyState>
                    ) : (
                      <BlockStack gap="100">
                        <Text variant="headingSm">{selectedProduct.title}</Text>
                        <Text variant="bodySm" tone="subdued">
                          {selectedProduct.handle ? `Handle: ${selectedProduct.handle}` : "No handle"}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          Status: {selectedProduct.status}
                        </Text>
                        {selectedProduct.vendor && (
                          <Text variant="bodySm" tone="subdued">
                            Vendor: {selectedProduct.vendor}
                          </Text>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Box>
              </Card>

              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Preview result
                      </Text>
                      {previewing && <Spinner size="small" />}
                    </InlineStack>

                    {!previewResult ? (
                      <EmptyState
                        heading="No preview yet"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Run a preview to inspect the normalized output and rule mapping.</p>
                      </EmptyState>
                    ) : (
                      <BlockStack gap="300">
                        {!previewResult.matched && (
                          <Banner tone="warning" title="Conditions did not match this product">
                            <p>The snippet evaluated successfully, but the preview product did not meet the rule conditions.</p>
                          </Banner>
                        )}

                        {previewResult.hasOutput ? (
                          <>
                            <BlockStack gap="150">
                              <Text variant="headingSm">Normalized output</Text>
                              <Box
                                as="pre"
                                background="bg-surface-secondary"
                                padding="300"
                                borderRadius="200"
                                overflowX="auto"
                              >
                                {formatJson(previewResult.normalizedOutput)}
                              </Box>
                            </BlockStack>

                            <BlockStack gap="150">
                              <Text variant="headingSm">Bulk rule mapping</Text>
                              <Box
                                as="pre"
                                background="bg-surface-secondary"
                                padding="300"
                                borderRadius="200"
                                overflowX="auto"
                              >
                                {formatJson(previewResult.rulePreview)}
                              </Box>
                            </BlockStack>
                          </>
                        ) : (
                          <EmptyState
                            heading="No output returned"
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          >
                            <p>This snippet resolved without any editable output for the selected product.</p>
                          </EmptyState>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>

      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Archive snippet"
        primaryAction={{
          content: "Archive",
          destructive: true,
          onAction: handleArchive,
          loading: saving,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowDeleteModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text>
            Archived snippets stay available for reference, but they are removed from active editing workflows.
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
