import React, { memo, useMemo } from "react";
import { Badge, Box, InlineStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const LOW_STOCK_THRESHOLD = 5;

function getVariantCount(product) {
  if (Array.isArray(product?.variants)) return product.variants.length;
  return Number(product?.variantCount ?? product?.variantsCount ?? 0);
}

function getInventoryState(product) {
  const totalInventory = Number(product?.totalInventory ?? 0);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantCount = getVariantCount(product);
  const inStockVariantCount = variants.filter(
    (variant) => Number(variant?.inventoryQuantity ?? 0) > 0
  ).length;
  const lowStockVariantCount = variants.filter((variant) => {
    const quantity = Number(variant?.inventoryQuantity ?? 0);
    return quantity > 0 && quantity <= LOW_STOCK_THRESHOLD;
  }).length;

  if (variantCount > 0 && inStockVariantCount === 0) {
    return {
      tone: "critical",
      kind: "out",
      count: variantCount,
    };
  }

  if (lowStockVariantCount > 0) {
    return {
      tone: "attention",
      kind: "low",
      count: lowStockVariantCount,
    };
  }

  if (totalInventory <= 0) {
    return {
      tone: "critical",
      kind: "out",
      count: variantCount,
    };
  }

  return {
    tone: "success",
    kind: "in",
    count: totalInventory,
  };
}

const InventoryStatus = memo(function InventoryStatus({ product }) {
  const { t, i18n } = useTranslation();
  const state = useMemo(() => getInventoryState(product), [product]);
  const countLabel = Number(state.count || 0).toLocaleString(i18n.language);

  const label =
    state.kind === "out"
      ? t("inventoryOutOfStock", {
          count: state.count,
          defaultValue: `Out of stock${
            state.count ? ` (${countLabel} variants)` : ""
          }`,
        })
      : state.kind === "low"
      ? t("inventoryLowStock", {
          count: state.count,
          defaultValue: `Low stock (${countLabel})`,
        })
      : t("inventoryInStock", {
          count: state.count,
          defaultValue: `In stock (${countLabel})`,
        });

  return (
    <Box minWidth="160px">
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Badge tone={state.tone}>{state.kind === "out" ? "!" : "✓"}</Badge>
        <Text as="span" variant="bodySm" truncate>
          {label}
        </Text>
      </InlineStack>
    </Box>
  );
});

export default InventoryStatus;
