// src/components/products/ProductCell.jsx

import React, { memo } from "react";
import { InlineStack, Box, Thumbnail, Text } from "@shopify/polaris";

function ProductCellComponent({
  title = "",
  handle = "",
  imageUrl = "",
}) {
  return (
    <InlineStack
      gap="300"
      blockAlign="center"
      wrap={false}
    >
      {/* Thumbnail — fixed width */}
      <Box minWidth="40px">
        <Thumbnail
          source={imageUrl}
          alt="" // decorative image
          size="small"
        />
      </Box>

      {/* Text container — CRITICAL FIX */}
      <Box
        maxWidth="320px"
        minWidth="0"   // ✅ REQUIRED for truncation
      >
        <Text
          as="p"
          fontWeight="medium"
          truncate
        >
          {title}
        </Text>

        {handle && (
          <Text
            as="p"
            tone="subdued"
            variant="bodySm"
            truncate
          >
            {handle}
          </Text>
        )}
      </Box>
    </InlineStack>
  );
}

/**
 * Memoized component
 */
const ProductCell = memo(ProductCellComponent);

export default ProductCell;