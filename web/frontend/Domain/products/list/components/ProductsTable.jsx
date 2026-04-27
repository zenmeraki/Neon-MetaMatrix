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

import { useMemo } from "react";
import ProductCell from "./ProductCell";
import StatusBadge from "./StatusBadge";
import { t } from "i18next";

const SKELETON_ROWS = 6;

const FALLBACK_IMAGE = "/images/fallback-2.png";



/* -----------------------------
   Loading Skeleton
----------------------------- */

function LoadingTable() {
  return (
    <>
      <Box
        padding="400"
        borderBlockEndWidth="1"
        borderColor="border"
      >
        <BlockStack gap="200">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={1} />
        </BlockStack>
      </Box>

      <Box overflowX="auto">
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "numeric",
            "text",
            "text",
          ]}
          headings={[
            t("product"),
            t("status"),
            t("inventory"),
            t("productType"),
            t("vendor"),
          ]}
          rows={Array.from({ length: SKELETON_ROWS }).map(
            (_, index) => [
              <SkeletonBodyText key={`product-${index}`} lines={1} />,
              <SkeletonBodyText key={`status-${index}`} lines={1} />,
              <SkeletonBodyText key={`inventory-${index}`} lines={1} />,
              <SkeletonBodyText key={`type-${index}`} lines={1} />,
              <SkeletonBodyText key={`vendor-${index}`} lines={1} />,
            ]
          )}
        />
      </Box>

      <Box
        padding="400"
        borderBlockStartWidth="1"
        borderColor="border"
      >
        <SkeletonBodyText lines={1} />
      </Box>
    </>
  );
}



export default function ProductsTable({
  products = [],
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
           heading={t("filteredProductsEmptyHeading")}
        >
          <p>
            {t("filteredProductsEmptyText")}
          </p>
        </EmptyState>
      </Box>
    );
  }



  /* -----------------------------
     Memoized Row Builder
     (Performance Critical Path)
  ----------------------------- */

  const rows = useMemo(() => {

    return products.map((product) => {

      /* Normalize primitives once */

      const title =
        product.title ?? "";

      const handle =
        product.handle ?? "";



      /* Resolve image ONCE */

      let resolvedImage =
        product.featuredImageUrl;

      if (!resolvedImage) {
        resolvedImage =
          product.featuredMedia?.preview?.image?.url;
      }

      if (!resolvedImage) {
        resolvedImage =
          FALLBACK_IMAGE;
      }



      return [
        <ProductCell
          key={product.id}
          title={title}
          handle={handle}
          imageUrl={resolvedImage}
        />,

        <StatusBadge
          status={product.status}
        />,

        product.totalInventory ?? "—",

        product.productType || "—",

        product.vendor || "—",
      ];

    });

  }, [products]);



  return (
    <>
      {/* Header */}

      <Box
        padding="400"
        borderBlockEndWidth="1"
        borderColor="border"
      >
        <InlineStack
          align="space-between"
          blockAlign="center"
          wrap
        >
          <BlockStack gap="100">
            <Box paddingInlineStart="600">

              <Text
                as="h3"
                variant="headingSm"
              >
                {t("exportFilteredProductsTitle")}
              </Text>

              <Text
                tone="subdued"
                variant="bodySm"
              >
                {t("paginationSummary", {
                  page: pagination?.page,
                  totalPages: pagination?.totalPages,
                  total: pagination?.total?.toLocaleString(),
                })}
              </Text>

            </Box>
          </BlockStack>
        </InlineStack>
      </Box>



      {/* Table */}

      <Box
        overflowX="auto"
        paddingInlineStart="600"
      >
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "numeric",
            "text",
            "text",
          ]}
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



      {/* Pagination */}

      <Box
        padding="400"
        borderBlockStartWidth="1"
        borderColor="border"
      >
        <InlineStack
          align="space-between"
          blockAlign="center"
        >

          <Text
            tone="subdued"
            variant="bodySm"
          >
            {t("exportFilteredProductsText")}
          </Text>

          <Pagination
            hasPrevious={
              pagination?.hasPrevPage
            }
            onPrevious={onPrev}
            hasNext={
              pagination?.hasNextPage
            }
            onNext={onNext}
          />

        </InlineStack>
      </Box>

    </>
  );
}