import {
  DataTable,
  Box,
  Text,
  EmptyState,
  InlineStack,
  Pagination,
  SkeletonBodyText,
  SkeletonDisplayText,
  BlockStack,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

import ProductCell from "./ProductCell";
import StatusBadge from "./StatusBadge";

const SKELETON_ROWS = 6;

function LoadingTable() {
  const { t } = useTranslation();

  return (
    <>
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <BlockStack gap="200">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={1} />
        </BlockStack>
      </Box>

      <Box overflowX="auto">
        <DataTable
          columnContentTypes={["text", "text", "numeric", "text", "text"]}
          headings={[
            t("product"),
            t("status"),
            t("inventory"),
            t("productType"),
            t("vendor"),
          ]}
          rows={Array.from({ length: SKELETON_ROWS }).map((_, index) => [
            <SkeletonBodyText key={`product-${index}`} lines={1} />,
            <SkeletonBodyText key={`status-${index}`} lines={1} />,
            <SkeletonBodyText key={`inventory-${index}`} lines={1} />,
            <SkeletonBodyText key={`type-${index}`} lines={1} />,
            <SkeletonBodyText key={`vendor-${index}`} lines={1} />,
          ])}
        />
      </Box>

      <Box padding="400" borderBlockStartWidth="1" borderColor="border">
        <SkeletonBodyText lines={1} />
      </Box>
    </>
  );
}

export default function ProductsTable({
  products,
  loading,
  pagination,
  onNext,
  onPrev,
}) {
  const { t, i18n } = useTranslation();

  if (loading) {
    return <LoadingTable />;
  }

  if (!products.length) {
    return (
      <Box padding="1200">
        <EmptyState
          heading={t("productsTableEmptyHeading", {
            defaultValue: "No products matched these filters",
          })}
        >
          <p>
            {t("productsTableEmptyBody", {
              defaultValue:
                "Try removing a filter or broadening your search to find products again.",
            })}
          </p>
        </EmptyState>
      </Box>
    );
  }

  const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);

  const rows = products.map((product) => [
    <ProductCell key={product.id} product={product} />,
    <StatusBadge status={product.status} />,
    product.totalInventory ?? "-",
    product.productType || "-",
    product.vendor || "-",
  ]);

  return (
    <>
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              {t("productsTableTitle", {
                defaultValue: "Filtered products",
              })}
            </Text>
            <Text tone="subdued" variant="bodySm">
              {t("productsTableSummary", {
                defaultValue:
                  "Page {{page}} of {{totalPages}} - {{total}} products",
                page: pagination?.page ?? 1,
                totalPages: pagination?.totalPages ?? 1,
                total: numberFormatter.format(pagination?.total ?? products.length),
              })}
            </Text>
          </BlockStack>
        </InlineStack>
      </Box>

      <Box overflowX="auto">
        <DataTable
          columnContentTypes={["text", "text", "numeric", "text", "text"]}
          headings={[
            t("product"),
            t("status"),
            t("inventory"),
            t("productType"),
            t("vendor"),
          ]}
          rows={rows}
        />
      </Box>

      <Box padding="400" borderBlockStartWidth="1" borderColor="border">
        <InlineStack align="space-between" blockAlign="center">
          <Text tone="subdued" variant="bodySm">
            {t("productsTableFooter", {
              defaultValue:
                "Use these results as the source for edits, previews, and exports.",
            })}
          </Text>
          <Pagination
            hasPrevious={pagination?.hasPrevPage}
            onPrevious={onPrev}
            hasNext={pagination?.hasNextPage}
            onNext={onNext}
          />
        </InlineStack>
      </Box>
    </>
  );
}
