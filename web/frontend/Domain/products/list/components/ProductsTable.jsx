import {
    DataTable,
    Box,
    Text,
    EmptyState,
    InlineStack,
    Pagination,
    SkeletonBodyText,
    SkeletonDisplayText,
} from "@shopify/polaris";

import ProductCell from "./ProductCell";
import StatusBadge from "./StatusBadge";
import { t } from "i18next";

const SKELETON_ROWS = 6;

export default function ProductsTable({
    products,
    loading,
    pagination,
    onNext,
    onPrev,
}) {
    /* ===============================
       Skeleton Loading
    ================================ */
    if (loading) {
        return (
            <>
                {/* Skeleton header */}
                <Box padding="400" borderBlockEndWidth="1" borderColor="border">
                    <SkeletonDisplayText size="small" />
                </Box>

                {/* Skeleton table */}
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
                                <SkeletonBodyText key={`p-${index}`} lines={1} />,
                                <SkeletonBodyText lines={1} />,
                                <SkeletonBodyText lines={1} />,
                                <SkeletonBodyText lines={1} />,
                                <SkeletonBodyText lines={1} />,
                            ]
                        )}
                    />
                </Box>

                {/* Skeleton pagination */}
                <Box padding="400" borderBlockStartWidth="1" borderColor="border">
                    <InlineStack align="end" gap="200">
                        <SkeletonBodyText lines={1} />
                    </InlineStack>
                </Box>
            </>
        );
    }

    /* ===============================
       Empty state
    ================================ */
    if (!products.length) {
        return (
            <Box padding="1200">
                <EmptyState heading="No products found" />
            </Box>
        );
    }

    /* ===============================
       Table rows
    ================================ */
    const rows = products.map((product) => [
        <ProductCell key={product.id} product={product} />,
        <StatusBadge status={product.status} />,
        product.totalInventory ?? "—",
        product.productType || "—",
        product.vendor || "—",
    ]);

    return (
        <>
            {/* Table header */}
            <Box padding="400" borderBlockEndWidth="1" borderColor="border">
                <InlineStack align="space-between">
                    <Text tone="subdued">
                        Page {pagination?.page} of {pagination?.totalPages} ·{" "}
                        {pagination?.total?.toLocaleString()} products
                    </Text>
                </InlineStack>
            </Box>

            {/* Table */}
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
                    rows={rows}
                />
            </Box>

            {/* Pagination */}
            <Box padding="400" borderBlockStartWidth="1" borderColor="border">
                <InlineStack>
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
