import React, { memo, useCallback, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { ExitIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import StatusBadge from "./StatusBadge";
import InventoryStatus from "./InventoryStatus";

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Archived", value: "ARCHIVED" },
];

const ProductPreviewDrawer = memo(function ProductPreviewDrawer({
  product,
  open = false,
  savingField = "",
  onClose,
  onInlineSave,
  onEditProduct,
}) {
  const { t, i18n } = useTranslation();
  const [vendorDraft, setVendorDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("DRAFT");

  React.useEffect(() => {
    if (!product) return;

    setVendorDraft(product.vendor || "");
    setStatusDraft(product.status || "DRAFT");
  }, [product]);

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: t(`statusChoices.${option.value.toLowerCase()}`, {
          defaultValue: option.label,
        }),
      })),
    [t]
  );

  const imageUrl =
    product?.featuredImageUrl ||
    product?.featuredMedia?.preview?.image?.url ||
    "";
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  const handleSaveVendor = useCallback(async () => {
    if (!product) return;

    const saved = await onInlineSave?.(product, "vendor", vendorDraft);
    if (saved === false) {
      setVendorDraft(product.vendor || "");
    }
  }, [onInlineSave, product, vendorDraft]);

  const handleSaveStatus = useCallback(async () => {
    if (!product) return;

    const saved = await onInlineSave?.(product, "status", statusDraft);
    if (saved === false) {
      setStatusDraft(product.status || "DRAFT");
    }
  }, [onInlineSave, product, statusDraft]);

  if (!open || !product) return null;

  return (
    <>
      <Box
        position="fixed"
        insetBlockStart="0"
        insetBlockEnd="0"
        insetInlineStart="0"
        insetInlineEnd="0"
        background="bg-surface-secondary"
        zIndex="4"
        onClick={onClose}
      />

      <Box
        as="aside"
        role="dialog"
        aria-modal="true"
        aria-label={t("productPreview", { defaultValue: "Product preview" })}
        position="fixed"
        insetBlockStart="0"
        insetBlockEnd="0"
        insetInlineEnd="0"
        width="480px"
        maxWidth="100%"
        background="bg-surface"
        shadow="500"
        zIndex="5"
        overflowY="auto"
        onClick={(event) => event.stopPropagation()}
      >
        <Box padding="500">
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="start" gap="300">
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <Thumbnail source={imageUrl || ""} alt="" size="large" />

                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg" truncate>
                    {product.title ||
                      t("untitledProduct", {
                        defaultValue: "Untitled product",
                      })}
                  </Text>
                  {product.handle ? (
                    <Text as="p" tone="subdued" variant="bodySm" truncate>
                      /{product.handle}
                    </Text>
                  ) : null}
                </BlockStack>
              </InlineStack>

              <Button
                icon={ExitIcon}
                variant="plain"
                onClick={onClose}
                accessibilityLabel={t("closeProductPreview", {
                  defaultValue: "Close product preview",
                })}
              />
            </InlineStack>

            <InlineStack gap="200" blockAlign="center" wrap>
              <StatusBadge status={product.status} />
              <InventoryStatus product={product} />
            </InlineStack>

            <Card roundedAbove="sm">
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    {t("productInfo", { defaultValue: "Product info" })}
                  </Text>

                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <InfoMetric
                      label={t("vendor", { defaultValue: "Vendor" })}
                      value={product.vendor || "-"}
                    />
                    <InfoMetric
                      label={t("productType", { defaultValue: "Type" })}
                      value={product.productType || "-"}
                    />
                    <InfoMetric
                      label={t("variants", { defaultValue: "Variants" })}
                      value={variants.length.toLocaleString(i18n.language)}
                    />
                    <InfoMetric
                      label={t("inventory", { defaultValue: "Inventory" })}
                      value={Number(product.totalInventory || 0).toLocaleString(
                        i18n.language
                      )}
                    />
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>

            <Card roundedAbove="sm">
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    {t("quickEdit", { defaultValue: "Quick edit" })}
                  </Text>

                  <BlockStack gap="200">
                    <TextField
                      label={t("vendor", { defaultValue: "Vendor" })}
                      value={vendorDraft}
                      autoComplete="off"
                      disabled={savingField === "vendor"}
                      onChange={setVendorDraft}
                    />
                    <InlineStack align="end">
                      <Button
                        size="slim"
                        onClick={handleSaveVendor}
                        loading={savingField === "vendor"}
                        disabled={savingField === "vendor"}
                      >
                        {t("saveVendor", { defaultValue: "Save vendor" })}
                      </Button>
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Select
                      label={t("status", { defaultValue: "Status" })}
                      options={statusOptions}
                      value={statusDraft}
                      disabled={savingField === "status"}
                      onChange={setStatusDraft}
                    />
                    <InlineStack align="end">
                      <Button
                        size="slim"
                        onClick={handleSaveStatus}
                        loading={savingField === "status"}
                        disabled={savingField === "status"}
                      >
                        {t("saveStatus", { defaultValue: "Save status" })}
                      </Button>
                    </InlineStack>
                  </BlockStack>

                  <Button
                    variant="plain"
                    onClick={() => onEditProduct?.(product)}
                    accessibilityLabel={t("openFullEditorAccessibilityLabel", {
                      defaultValue: "Open full product editor",
                    })}
                  >
                    {t("openFullEditor", { defaultValue: "Open full editor" })}
                  </Button>
                </BlockStack>
              </Box>
            </Card>

            <Card roundedAbove="sm">
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    {t("variants", { defaultValue: "Variants" })}
                  </Text>

                  {variants.length > 0 ? (
                    <BlockStack gap="200">
                      {variants.slice(0, 8).map((variant) => (
                        <InlineStack
                          key={variant.id}
                          align="space-between"
                          blockAlign="center"
                          gap="300"
                          wrap={false}
                        >
                          <Box minWidth="0">
                            <Text as="p" variant="bodyMd" truncate>
                              {variant.title || variant.sku || variant.id}
                            </Text>
                            {variant.sku ? (
                              <Text
                                as="p"
                                tone="subdued"
                                variant="bodySm"
                                truncate
                              >
                                {variant.sku}
                              </Text>
                            ) : null}
                          </Box>

                          <Badge
                            tone={
                              Number(variant.inventoryQuantity || 0) > 0
                                ? "success"
                                : "critical"
                            }
                          >
                            {Number(
                              variant.inventoryQuantity || 0
                            ).toLocaleString(i18n.language)}
                          </Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">
                      {t("noVariantsAvailable", {
                        defaultValue:
                          "No variants available in the mirror yet.",
                      })}
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Box>
      </Box>
    </>
  );
});

function InfoMetric({ label, value }) {
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">
        {label}
      </Text>
      <Text as="span" variant="bodyMd" truncate>
        {value}
      </Text>
    </BlockStack>
  );
}

export default ProductPreviewDrawer;
