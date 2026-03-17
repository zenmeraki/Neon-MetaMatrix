// src/components/products/ProductCell.jsx

import { InlineStack, Box, Thumbnail, Text } from "@shopify/polaris";

export default function ProductCell({ product }) {
    const imageUrl =
        product.featuredMedia?.preview?.image?.url ||
        "https://www.otithee.com/img/fallback/fallback-2.png";

    return (
        <InlineStack gap="400">
            <Box minWidth="40px">
                <Thumbnail source={imageUrl} alt={product.title} size="small" />
            </Box>

            <Box maxWidth="300px">
                <Text as="p" fontWeight="medium" truncate>
                    {product.title}
                </Text>
            </Box>
        </InlineStack>
    );
}
