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
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const FALLBACK_IMAGE = "https://www.otithee.com/img/fallback/fallback-2.png";

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "object") {
    return value.text ?? value.label ?? value.value ?? JSON.stringify(value);
  }

  return String(value);
};

const COLUMN_WIDTHS = {
  product: "280px",
  variant: "220px",
  field: "180px",
  value: "240px",
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
  const itemsPerPage = limit;
  const fieldLabel = t(`fieldLabels.${field}`, {
    defaultValue: formatValue(field),
  });

  if (loading) {
    return (
      <Card>
        <Box padding="800">
          <SkeletonBodyText lines={10} />
        </Box>
      </Card>
    );
  }

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

  const headings = isVariant
    ? [
        t("table.product"),
        t("table.variant"),
        t("table.field"),
        t("table.current", { defaultValue: "Current" }),
        t("table.new"),
      ]
    : [
        t("table.product"),
        t("table.field"),
        t("table.current", { defaultValue: "Current" }),
        t("table.new"),
      ];

  const columnContentTypes = isVariant
    ? ["text", "text", "text", "text", "text"]
    : ["text", "text", "text", "text"];

  const buildProductCell = (product) => (
    <Box width={COLUMN_WIDTHS.product} maxWidth={COLUMN_WIDTHS.product}>
      <InlineStack gap="300" wrap={false} blockAlign="center">
        <Thumbnail
          source={product.img || FALLBACK_IMAGE}
          alt={formatValue(product.title)}
          size="small"
        />
        <Text truncate variant="bodyMd" fontWeight="medium">
          {formatValue(product.title)}
        </Text>
      </InlineStack>
    </Box>
  );

  const buildFieldCell = () => (
    <Box width={COLUMN_WIDTHS.field} maxWidth={COLUMN_WIDTHS.field}>
      <Text truncate variant="bodyMd" fontWeight="semibold">
        {fieldLabel}
      </Text>
    </Box>
  );

  const buildCurrentCell = (value) => (
    <Box width={COLUMN_WIDTHS.value} maxWidth={COLUMN_WIDTHS.value}>
      <Text
        as="span"
        tone="subdued"
        textDecorationLine="line-through"
        style={{ wordBreak: "break-word", whiteSpace: "normal" }}
      >
        {formatValue(value)}
      </Text>
    </Box>
  );

  const buildNewCell = (value) => (
    <Box width={COLUMN_WIDTHS.value} maxWidth={COLUMN_WIDTHS.value}>
      <Text
        as="span"
        variant="bodyMd"
        fontWeight="semibold"
        tone="success"
        style={{ wordBreak: "break-word", whiteSpace: "normal" }}
      >
        {formatValue(value)}
      </Text>
    </Box>
  );

  const rows = products.flatMap((product) => {
    const productCell = buildProductCell(product);

    if (!isVariant) {
      return [
        [
          productCell,
          buildFieldCell(),
          buildCurrentCell(product.oldValue),
          buildNewCell(product.newValue),
        ],
      ];
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];

    if (variants.length === 0) {
      return [
        [
          productCell,
          <Box width={COLUMN_WIDTHS.variant} maxWidth={COLUMN_WIDTHS.variant}>
            <Text tone="subdued">-</Text>
          </Box>,
          buildFieldCell(),
          buildCurrentCell(product.oldValue),
          buildNewCell(product.newValue),
        ],
      ];
    }

    return variants.map((variant) => [
      buildProductCell(product),
      <Box width={COLUMN_WIDTHS.variant} maxWidth={COLUMN_WIDTHS.variant}>
        <Badge tone="info">
          <Text truncate>{formatValue(variant.title)}</Text>
        </Badge>
      </Box>,
      buildFieldCell(),
      buildCurrentCell(variant.oldValue),
      buildNewCell(variant.newValue),
    ]);
  });

  const totalItems = total ?? products.length;
  const showingFrom = totalItems > 0 ? (page - 1) * itemsPerPage + 1 : 0;
  const showingTo = Math.min(page * itemsPerPage, totalItems);

  return (
    <BlockStack gap="400">
      <Card padding="0">
        <Box
          overflowX="auto"
          width="100%"
          paddingInlineStart="800"
          paddingBlockStart="400"
        >
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
                {showingFrom}
              </Text>{" "}
              {t("to")}{" "}
              <Text as="span" fontWeight="medium">
                {showingTo}
              </Text>{" "}
              {t("of")}{" "}
              <Text as="span" fontWeight="medium">
                {totalItems}
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
