import { memo } from "react";
import { Box, InlineStack, Pagination, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const ProductsPaginationFooter = memo(function ProductsPaginationFooter({
  products = [],
  pagination,
  lastUpdatedAt,
  onNext,
  onPrev,
}) {
  const { t, i18n } = useTranslation();

  const page = Number(pagination?.page || 1);
  const pageSize = Number(pagination?.limit || products.length || 0);
  const total = Number(pagination?.total ?? pagination?.totalCount ?? 0);

  const start = total > 0 && pageSize > 0 ? (page - 1) * pageSize + 1 : 0;
  const end = total > 0 ? Math.min(start + products.length - 1, total) : 0;

  const rangeLabel =
    total > 0
      ? t("productsPaginationRange", {
          start: start.toLocaleString(i18n.language),
          end: end.toLocaleString(i18n.language),
          total: total.toLocaleString(i18n.language),
          defaultValue: `Showing ${start.toLocaleString(
            i18n.language
          )}-${end.toLocaleString(i18n.language)} of ${total.toLocaleString(
            i18n.language
          )} products`,
        })
      : t("productsPaginationHint", {
          defaultValue: "Showing current result",
        });

  const lastUpdatedLabel = getLastUpdatedLabel({ lastUpdatedAt, t });

  return (
    <Box
      paddingBlock="300"
      paddingInline="400"
      borderBlockStartWidth="025"
      borderColor="border"
      background="bg-surface"
    >
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span" tone="subdued" variant="bodySm">
            {rangeLabel}
          </Text>

          {lastUpdatedLabel ? (
            <Text as="span" tone="subdued" variant="bodySm">
              {lastUpdatedLabel}
            </Text>
          ) : null}
        </InlineStack>

        <Pagination
          hasPrevious={Boolean(pagination?.hasPrevPage)}
          onPrevious={onPrev}
          hasNext={Boolean(pagination?.hasNextPage)}
          onNext={onNext}
        />
      </InlineStack>
    </Box>
  );
});

function getLastUpdatedLabel({ lastUpdatedAt, t }) {
  if (!lastUpdatedAt) return "";

  const updatedAt = new Date(lastUpdatedAt).getTime();
  if (Number.isNaN(updatedAt)) return "";

  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);

  if (elapsedMinutes < 1) {
    return t("lastUpdatedJustNow", {
      defaultValue: "Last updated just now",
    });
  }

  if (elapsedMinutes < 60) {
    return t("lastUpdatedMinutesAgo", {
      count: elapsedMinutes,
      defaultValue: `Last updated ${elapsedMinutes} min ago`,
    });
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  return t("lastUpdatedHoursAgo", {
    count: elapsedHours,
    defaultValue: `Last updated ${elapsedHours} hr ago`,
  });
}

export default ProductsPaginationFooter;