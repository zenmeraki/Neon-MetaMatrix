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
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const FALLBACK_IMAGE = "https://www.otithee.com/img/fallback/fallback-2.png";

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    return value.text ?? value.label ?? value.value ?? JSON.stringify(value);
  }
  return String(value);
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
  const { page = 1, totalPages = 1, total, limit = 10 } = pagination || {};
  const fieldLabel = t(`fieldLabels.${field}`, { defaultValue: formatValue(field) });

  if (loading) {
    return (
      <Card>
        <Box padding="600">
          <BlockStack gap="400">
            <SkeletonBodyText lines={1} />
            <Divider />
            <SkeletonBodyText lines={8} />
          </BlockStack>
        </Box>
      </Card>
    );
  }

  if (!products || products.length === 0) {
    return (
      <Card>
        <EmptyState
          heading={t("NoProductMatchfilter", { defaultValue: "No products match your filters" })}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p" tone="subdued">
            {t("TryAdjustingYourFiltersResults", { defaultValue: "Try adjusting your filters or search to find matching products." })}
          </Text>
        </EmptyState>
      </Card>
    );
  }

  const headings = isVariant
    ? [
        t("table.product", { defaultValue: "Product" }),
        t("table.variant", { defaultValue: "Variant" }),
        t("table.field", { defaultValue: "Field" }),
        t("table.current", { defaultValue: "Current value" }),
        t("table.new", { defaultValue: "New value" }),
      ]
    : [
        t("table.product", { defaultValue: "Product" }),
        t("table.field", { defaultValue: "Field" }),
        t("table.current", { defaultValue: "Current value" }),
        t("table.new", { defaultValue: "New value" }),
      ];

  const columnContentTypes = isVariant
    ? ["text", "text", "text", "text", "text"]
    : ["text", "text", "text", "text"];

  const buildProductCell = (product) => (
    <Box minWidth="240px" maxWidth="280px">
      <InlineStack gap="300" wrap={false} blockAlign="center">
        <Box flexShrink="0">
          <Thumbnail
            source={product.img || FALLBACK_IMAGE}
            alt={formatValue(product.title)}
            size="small"
          />
        </Box>
        <Text truncate variant="bodyMd" fontWeight="semibold">
          {formatValue(product.title)}
        </Text>
      </InlineStack>
    </Box>
  );

  const buildVariantCell = (variant) => (
    <Box minWidth="160px" maxWidth="200px">
      <Badge tone="info">
        <Text as="span" variant="bodySm" truncate>
          {formatValue(variant?.title)}
        </Text>
      </Badge>
    </Box>
  );

  const buildFieldCell = () => (
    <Box minWidth="140px" maxWidth="180px">
      <Badge tone="enabled">
        <Text as="span" variant="bodySm" fontWeight="medium">
          {fieldLabel}
        </Text>
      </Badge>
    </Box>
  );

  const buildCurrentCell = (value) => (
    <Box minWidth="160px" maxWidth="220px">
      <Text
        as="span"
        variant="bodySm"
        tone="subdued"
        textDecorationLine="line-through"
      >
        {formatValue(value)}
      </Text>
    </Box>
  );

  const buildNewCell = (value) => (
    <Box minWidth="160px" maxWidth="220px">
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        <Box
          width="6px"
          minWidth="6px"
          height="6px"
          background="bg-fill-success"
          borderRadius="full"
        />
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="success">
          {formatValue(value)}
        </Text>
      </InlineStack>
    </Box>
  );

  const rows = products.flatMap((product) => {
    const productCell = buildProductCell(product);

    if (!isVariant) {
      return [[
        productCell,
        buildFieldCell(),
        buildCurrentCell(product.oldValue),
        buildNewCell(product.newValue),
      ]];
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];

    if (variants.length === 0) {
      return [[
        productCell,
        <Box minWidth="160px"><Text tone="subdued" variant="bodySm">—</Text></Box>,
        buildFieldCell(),
        buildCurrentCell(product.oldValue),
        buildNewCell(product.newValue),
      ]];
    }

    return variants.map((variant) => [
      buildProductCell(product),
      buildVariantCell(variant),
      buildFieldCell(),
      buildCurrentCell(variant.oldValue),
      buildNewCell(variant.newValue),
    ]);
  });

  const totalItems = total ?? products.length;
  const showingFrom = totalItems > 0 ? (page - 1) * limit + 1 : 0;
  const showingTo = Math.min(page * limit, totalItems);

  return (
    <Card padding="0">
      <Box overflowX="auto">
        <DataTable
          columnContentTypes={columnContentTypes}
          headings={headings}
          rows={rows}
          hoverable
          increasedTableDensity
        />
      </Box>

      <Box
        background="bg-surface-secondary"
        paddingBlock="300"
        paddingInline="500"
        borderBlockStartWidth="025"
        borderColor="border"
      >
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("Showing", { defaultValue: "Showing" })}{" "}
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="base">
              {showingFrom}–{showingTo}
            </Text>{" "}
            {t("of", { defaultValue: "of" })}{" "}
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="base">
              {totalItems.toLocaleString()}
            </Text>{" "}
            {t("products", { defaultValue: "products" })}
          </Text>

          <Pagination
            hasPrevious={page > 1}
            onPrevious={() => onPageChange(page - 1)}
            hasNext={page < totalPages}
            onNext={() => onPageChange(page + 1)}
            label={`${page} / ${totalPages}`}
          />
        </InlineStack>
      </Box>
    </Card>
  );
};

export default PreviewTable;