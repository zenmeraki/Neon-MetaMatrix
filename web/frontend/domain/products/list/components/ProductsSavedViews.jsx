import React, { memo, useMemo } from "react";
import { Box, Tabs } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const ProductsSavedViews = memo(function ProductsSavedViews({
  selected = 0,
  presetViews = [],
  savedSegments = [],
  onSelect,
}) {
  const { t } = useTranslation();

  const tabs = useMemo(
    () => {
      const baseTabs = [
        ...presetViews.map((preset) => ({
          id: `preset:${preset.id}`,
          content: preset.name,
          accessibilityLabel: preset.name,
          panelID: `products-preset-${preset.id}`,
        })),
      ];

      const segmentTabs = savedSegments.map((segment) => ({
        id: segment.id,
        content: segment.name,
        accessibilityLabel: t("savedSegmentAccessibilityLabel", {
          name: segment.name,
          defaultValue: `Saved segment ${segment.name}`,
        }),
        panelID: `products-segment-${segment.id}`,
      }));

      return [...baseTabs, ...segmentTabs];
    },
    [presetViews, savedSegments, t]
  );

  return (
    <Box borderBlockEndWidth="025" borderColor="border">
      <Tabs tabs={tabs} selected={selected} onSelect={onSelect} />
    </Box>
  );
});

export default ProductsSavedViews;
