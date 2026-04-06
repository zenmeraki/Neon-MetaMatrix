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

import ProductCell from "./ProductCell";
import StatusBadge from "./StatusBadge";
import { t } from "i18next";

const SKELETON_ROWS = 6;

function LoadingTable() {
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
  if (loading) {
    return <LoadingTable />;
  }

  if (!products.length) {
    return (
      <Box padding="1200">
        <EmptyState
          heading="No products matched these filters"
        >
          <p>
            {t("filteredProductsEmptyText",)}
          </p>
        </EmptyState>
      </Box>
    );
  }

  const rows = products.map((product) => [
    <ProductCell key={product.id} product={product} />,
    <StatusBadge status={product.status} />,
    product.totalInventory ?? "—",
    product.productType || "—",
    product.vendor || "—",
  ]);

  return (
    <>
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Box paddingInlineStart="600">
              <Text as="h3" variant="headingSm">
                {t("exportFilteredProductsTitle",)}
              </Text>
              <Text tone="subdued" variant="bodySm">
                Page {pagination?.page} of {pagination?.totalPages} · {pagination?.total?.toLocaleString()} products
              </Text>
            </Box>
          </BlockStack>
        </InlineStack>
      </Box>

      <Box overflowX="auto" paddingInlineStart="600">
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
            {t("exportFilteredProductsText",)}
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