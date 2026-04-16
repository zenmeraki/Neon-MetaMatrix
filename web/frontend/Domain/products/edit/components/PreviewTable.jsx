import React from "react";
import {
  Card,
  DataTable,
  Thumbnail,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Pagination,
  Box,
  SkeletonBodyText,
  EmptyState,
  Banner,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { productFallbackImage } from "../../../../assets";

/**
 * ✅ Safely format values for rendering
 */
const formatValue = (value) => {
  if (value === null || value === undefined) return "-**";

  if (typeof value === "object") {
    return value.text ?? value.label ?? value.value ?? JSON.stringify(value);
  }
  return String(value);
};

/**
 * ✅ Fixed column widths
 */
const COLUMN_WIDTHS = {
  product: "280px",
  variant: "220px",
  change: "320px", // slightly wider for full values
};

const PreviewTable = ({
  loading,
  products,
  pagination,
  onPageChange,
  isVariant,
  field,
}) => {
  const { t } = useTranslation();

  const { page, totalPages, total, limit } = pagination;
  const itemsPerPage = limit;

  // ===============================
  // Loading state
  // ===============================
  if (loading) {
    return (
      <Card>
        <Box padding="800">
          <SkeletonBodyText lines={10} />
        </Box>
      </Card>
    );
  }

  // ===============================
  // Empty state
  // ===============================
  if (!products || products.length === 0) {
    return (
      <Card>
        <EmptyState
          heading={t("NoProductMatchfilter")}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p" tone="subdued">
            {t("TryAdjustingYourFiltersResults")}
          </Text>
        </EmptyState>
      </Card>
    );
  }

  // ===============================
  // Table configuration
  // ===============================
  const headings = isVariant
    ? [t("table.product"), t("table.variant"), t("table.change")]
    : [t("table.product"), t("table.change")];

  const columnContentTypes = isVariant
    ? ["text", "text", "text"]
    : ["text", "text"];

  // ===============================
  // Build rows
  // ===============================
  const rows = products.map((product) => {
    const productCell = (
      <Box width={COLUMN_WIDTHS.product} maxWidth={COLUMN_WIDTHS.product}>
        <InlineStack gap="300" wrap={false} blockAlign="center">
          <Thumbnail
            source={product.img || productFallbackImage}
            alt=""
            size="small"
          />
          <Text truncate variant="bodyMd" fontWeight="medium">
            {formatValue(product.title)}
          </Text>
        </InlineStack>
      </Box>
    );

    const variantCell = (
      <Box width={COLUMN_WIDTHS.variant} maxWidth={COLUMN_WIDTHS.variant}>
        <InlineStack gap="200" wrap={true}>
          {product.variants?.map((variant) => (
            <Badge key={variant.id} tone="info">
              <Text truncate>{formatValue(variant.title)}</Text>
            </Badge>
          ))}
        </InlineStack>
      </Box>
    );

    const changeCell = isVariant ? (
      <Box width={COLUMN_WIDTHS.change} maxWidth={COLUMN_WIDTHS.change}>
        <BlockStack gap="200">
          {product.variants?.map((variant) => (
            <InlineStack key={variant.id} gap="200" align="start">
              <Text
                as="span"
                tone="subdued"
                textDecorationLine="line-through"
                style={{ wordBreak: "break-word", whiteSpace: "normal" }}
              >
                {formatValue(variant.oldValue)}
              </Text>
              <Text
                as="span"
                variant="bodyMd"
                fontWeight="semibold"
                tone="success"
                style={{ wordBreak: "break-word", whiteSpace: "normal" }}
              >
                {formatValue(variant.newValue)}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Box>
    ) : (
      <Box width={COLUMN_WIDTHS.change} maxWidth={COLUMN_WIDTHS.change}>
        <InlineStack gap="200" align="start">
          <Text
            as="span"
            tone="subdued"
            textDecorationLine="line-through"
            style={{ wordBreak: "break-word", whiteSpace: "normal" }}
          >
            {formatValue(product.oldValue)}
          </Text>
          <Text
            as="span"
            variant="bodyMd"
            fontWeight="semibold"
            tone="success"
            style={{ wordBreak: "break-word", whiteSpace: "normal" }}
          >
            {formatValue(product.newValue)}
          </Text>
        </InlineStack>
      </Box>
    );

    return isVariant
      ? [productCell, variantCell, changeCell]
      : [productCell, changeCell];
  });

  // ===============================
  // Render table (horizontal scroll)
  // ===============================
  return (
    <BlockStack gap="400">
      <Card padding="0">
        <Box overflowX="auto" width="100%" paddingInlineStart="800" paddingBlockStart="400">
          <DataTable
            columnContentTypes={columnContentTypes}
            headings={headings}
            rows={rows}
            hoverable
          />
        </Box>

        <Box
          background="bg-surface-secondary"
          padding="400"
          borderBlockStartWidth="025"
          borderColor="border"
        >
          <InlineStack gap="100" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("Showing")}{" "}
              <Text as="span" fontWeight="medium">
                {(page - 1) * itemsPerPage + 1}
              </Text>{" "}
              {t("to")}{" "}
              <Text as="span" fontWeight="medium">
                {Math.min(page * itemsPerPage, total ?? products.length)}
              </Text>{" "}
              {t("of")}{" "}
              <Text as="span" fontWeight="medium">
                {total ?? products.length}
              </Text>{" "}
              {t("products")}
            </Text>

            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => onPageChange(page - 1)}
              hasNext={page < totalPages}
              onNext={() => onPageChange(page + 1)}
            />
          </InlineStack>
        </Box>
      </Card>
    </BlockStack>
  );
};

export default PreviewTable;
