// src/components/products/ProductCell.jsx
import { memo } from "react";
import { InlineStack, Box, Thumbnail, Text } from "@shopify/polaris";

function ProductCell({ product }) {
    const imageUrl =
        product.featuredImageUrl ||
        product.featuredMedia?.preview?.image?.url ||
        "https://www.otithee.com/img/fallback/fallback-2.png";

    return (
        <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Box minWidth="40px">
                <Thumbnail source={imageUrl} alt={product.title} size="small" />
            </Box>

            <Box maxWidth="320px">
                <Text as="p" fontWeight="medium" truncate>
                    {product.title}
                </Text>
                {product.handle && (
                    <Text as="p" tone="subdued" variant="bodySm" truncate>
                        {product.handle}
                    </Text>
                )}
            </Box>
        </InlineStack>
    );
}

export default memo(ProductCell);
