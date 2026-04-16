import { memo, useMemo } from "react";
import {
  IndexTable,
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
const RESOURCE_NAME = { singular: "product", plural: "products" };

function useTableHeadings() {
  const { t } = useTranslation();

  return useMemo(
    () => [t("product"), t("status"), t("inventory"), t("productType"), t("vendor")],
    [t]
  );
}

function useIndexTableHeadings(headings) {
  return useMemo(
    () =>
      headings.map((title, index) => ({
        title,
        alignment: index === 2 ? "end" : "start",
      })),
    [headings]
  );
}

function LoadingTable() {
  const headings = useTableHeadings();
  const indexHeadings = useIndexTableHeadings(headings);

  return (
    <div className="products-table-frame">
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <div className="products-table-header">
          <BlockStack gap="200">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={1} />
          </BlockStack>
        </div>
      </Box>

      <div className="products-table-body">
        <Box overflowX="auto" paddingInlineStart="600">
          <IndexTable
            resourceName={RESOURCE_NAME}
            itemCount={SKELETON_ROWS}
            headings={indexHeadings}
            selectable={false}
          >
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <IndexTable.Row id={`loading-product-${index}`} key={index} position={index}>
                <IndexTable.Cell>
                  <SkeletonBodyText lines={1} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <SkeletonBodyText lines={1} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <SkeletonBodyText lines={1} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <SkeletonBodyText lines={1} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <SkeletonBodyText lines={1} />
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Box>
      </div>

      <Box padding="400" borderBlockStartWidth="1" borderColor="border">
        <div className="products-table-footer">
          <SkeletonBodyText lines={1} />
        </div>
      </Box>
    </div>
  );
}

function ProductsTable({
  products = [],
  loading,
  pagination,
  onNext,
  onPrev,
}) {
  const { t } = useTranslation();
  const headings = useTableHeadings();
  const indexHeadings = useIndexTableHeadings(headings);

  if (loading) {
    return <LoadingTable />;
  }

  if (!products.length) {
    return (
      <div className="products-table-frame">
        <Box padding="1200">
          <div className="products-table-body">
            <EmptyState heading={t("filteredProductsEmptyHeading")}>
              <p>{t("filteredProductsEmptyText")}</p>
            </EmptyState>
          </div>
        </Box>
      </div>
    );
  }

  return (
    <div className="products-table-frame">
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <div className="products-table-header">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="100">
              <Box paddingInlineStart="600">
                <Text as="h3" variant="headingSm">
                  {t("exportFilteredProductsTitle")}
                </Text>
                <Text tone="subdued" variant="bodySm">
                  {t("paginationSummary", {
                    page: pagination?.page ?? 1,
                    totalPages: pagination?.totalPages ?? 1,
                    total: (pagination?.total ?? 0).toLocaleString(),
                  })}
                </Text>
              </Box>
            </BlockStack>
          </InlineStack>
        </div>
      </Box>

      <div className="products-table-body">
        <Box overflowX="auto" paddingInlineStart="600">
          <IndexTable
            resourceName={RESOURCE_NAME}
            itemCount={products.length}
            headings={indexHeadings}
            selectable={false}
          >
            {products.map((product, index) => (
              <IndexTable.Row id={product.id} key={product.id} position={index}>
                <IndexTable.Cell>
                  <ProductCell product={product} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <StatusBadge status={product.status} />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end" numeric>
                    {product.totalInventory ?? "-"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{product.productType || "-"}</IndexTable.Cell>
                <IndexTable.Cell>{product.vendor || "-"}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Box>
      </div>

      <Box padding="400" borderBlockStartWidth="1" borderColor="border">
        <div className="products-table-footer">
          <InlineStack align="space-between" blockAlign="center">
            <Text tone="subdued" variant="bodySm">
              {t("exportFilteredProductsText")}
            </Text>
            <Pagination
              hasPrevious={pagination?.hasPrevPage}
              onPrevious={onPrev}
              hasNext={pagination?.hasNextPage}
              onNext={onNext}
            />
          </InlineStack>
        </div>
      </Box>
    </div>
  );
}

export default memo(ProductsTable);
