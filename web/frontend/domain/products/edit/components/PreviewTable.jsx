import React, { useMemo, useCallback } from "react";
import {
  Card,
  IndexTable,
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

const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='%23f1f2f3'/></svg>";
const MAX_RENDER_ROWS = 200;
const MAX_VARIANTS_PER_PRODUCT = 20;
const MAX_SERIALIZED_VALUE_LENGTH = 200;
const CELL_TEXT_STYLE = { wordBreak: "break-word", whiteSpace: "normal" };

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "object") {
    const resolved = value.text ?? value.label ?? value.value;
    if (resolved !== undefined && resolved !== null && resolved !== "") {
      return String(resolved);
    }
    const preview = Object.entries(value)
      .slice(0, 5)
      .map(([key, entry]) => `${key}:${String(entry)}`)
      .join(", ");
    return preview.length > MAX_SERIALIZED_VALUE_LENGTH
      ? `${preview.slice(0, MAX_SERIALIZED_VALUE_LENGTH)}...`
      : preview;
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
  const fieldLabel = useMemo(
    () =>
      t(`fieldLabels.${field}`, {
        defaultValue: formatValue(field),
      }),
    [field, t]
  );

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
        <EmptyState heading={t("NoProductMatchfilter")}>
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

  const buildProductCell = (product) => (
    <Box width={COLUMN_WIDTHS.product} maxWidth={COLUMN_WIDTHS.product}>
      <InlineStack gap="300" wrap={false} blockAlign="center">
        <Thumbnail
          source={typeof product.img === "string" && product.img.trim() ? product.img : FALLBACK_IMAGE}
          alt={formatValue(product.title)}
          size="small"
        />
        <Box minWidth="0">
          <Text as="span" truncate variant="bodyMd" fontWeight="medium">
            {formatValue(product.title)}
          </Text>
        </Box>
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
        truncate
        style={CELL_TEXT_STYLE}
      >
        {String(formatValue(value)).slice(0, 400)}
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
        truncate
        style={CELL_TEXT_STYLE}
      >
        {String(formatValue(value)).slice(0, 400)}
      </Text>
    </Box>
  );

  const tableRows = useMemo(() => {
    const rows = [];

    for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
      if (rows.length >= MAX_RENDER_ROWS) break;
      const product = products[productIndex];
      const productCell = buildProductCell(product);

      if (!isVariant) {
        rows.push({
          key: `p-${product.id || productIndex}`,
          productCell,
          variantCell: null,
          currentValue: product.oldValue,
          newValue: product.newValue,
        });
        continue;
      }

      const variants = Array.isArray(product.variants) ? product.variants : [];
      if (variants.length === 0) {
        rows.push({
          key: `pv-${product.id || productIndex}-none`,
          productCell,
          variantCell: (
            <Box width={COLUMN_WIDTHS.variant} maxWidth={COLUMN_WIDTHS.variant}>
              <Text tone="subdued">-</Text>
            </Box>
          ),
          currentValue: product.oldValue,
          newValue: product.newValue,
        });
        continue;
      }

      for (
        let variantIndex = 0;
        variantIndex < Math.min(variants.length, MAX_VARIANTS_PER_PRODUCT);
        variantIndex += 1
      ) {
        if (rows.length >= MAX_RENDER_ROWS) break;
        const variant = variants[variantIndex];
        rows.push({
          key: `pv-${product.id || productIndex}-${variant.id || variantIndex}`,
          productCell,
          variantCell: (
            <Box width={COLUMN_WIDTHS.variant} maxWidth={COLUMN_WIDTHS.variant}>
              <Badge tone="info">
                <Text truncate>{formatValue(variant.title)}</Text>
              </Badge>
            </Box>
          ),
          currentValue: variant.oldValue,
          newValue: variant.newValue,
        });
      }
    }

    return rows;
  }, [isVariant, products]);

  const totalItems = total ?? products.length;
  const itemLabel = isVariant
    ? t("variants", { defaultValue: "variants" })
    : t("products", { defaultValue: "products" });
  const showingFrom = totalItems > 0 ? (page - 1) * itemsPerPage + 1 : 0;
  const showingTo = Math.min(page * itemsPerPage, totalItems);
  const hasRenderCap = tableRows.length >= MAX_RENDER_ROWS;

  const handlePrevious = useCallback(() => {
    onPageChange(Math.max(1, page - 1));
  }, [onPageChange, page]);

  const handleNext = useCallback(() => {
    onPageChange(Math.min(totalPages, page + 1));
  }, [onPageChange, page, totalPages]);

  return (
    <BlockStack gap="400">
      <Card padding="0">
        <Box
          overflowX="auto"
          width="100%"
          paddingInlineStart="800"
          paddingBlockStart="400"
        >
          <IndexTable
            resourceName={{
              singular: t("table.row", { defaultValue: "row" }),
              plural: t("table.rows", { defaultValue: "rows" }),
            }}
            itemCount={tableRows.length}
            selectable={false}
            headings={headings.map((heading, index) => ({
              id: `heading-${index}`,
              title: heading,
            }))}
          >
            {tableRows.map((row, index) => (
              <IndexTable.Row id={row.key} key={row.key} position={index}>
                <IndexTable.Cell>{row.productCell}</IndexTable.Cell>
                {isVariant ? <IndexTable.Cell>{row.variantCell}</IndexTable.Cell> : null}
                <IndexTable.Cell>{buildFieldCell()}</IndexTable.Cell>
                <IndexTable.Cell>{buildCurrentCell(row.currentValue)}</IndexTable.Cell>
                <IndexTable.Cell>{buildNewCell(row.newValue)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Box>
        {hasRenderCap ? (
          <Box paddingInline="400" paddingBlockEnd="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("previewRenderCapped", {
                defaultValue: `Preview rendering capped at ${MAX_RENDER_ROWS} rows for performance.`,
              })}
            </Text>
          </Box>
        ) : null}

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
              {itemLabel}
            </Text>

            <Pagination
              hasPrevious={page > 1}
              onPrevious={handlePrevious}
              hasNext={page < totalPages}
              onNext={handleNext}
            />
          </InlineStack>
        </Box>
      </Card>
    </BlockStack>
  );
};

export default React.memo(PreviewTable);
