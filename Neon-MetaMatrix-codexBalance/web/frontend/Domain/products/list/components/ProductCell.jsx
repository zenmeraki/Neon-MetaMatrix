import React, { memo } from "react";
import { InlineStack, Box, Thumbnail, Text } from "@shopify/polaris";

function ProductCellComponent({ title = "", handle = "", imageUrl = "" }) {
  const productTitle = title?.trim() || "Untitled product";
  const productHandle = handle?.trim() ? `/${handle.trim()}` : "";

  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Box minWidth="40px" width="40px">
        <Thumbnail source={imageUrl || ""} alt="" size="small" />
      </Box>

      <Box minWidth="0" maxWidth="320px">
        <Text as="span" fontWeight="medium" truncate>
          {productTitle}
        </Text>

        {productHandle ? (
          <Text as="span" tone="subdued" variant="bodySm" truncate>
            {productHandle}
          </Text>
        ) : null}
      </Box>
    </InlineStack>
  );
}

const ProductCell = memo(ProductCellComponent);

export default ProductCell;
