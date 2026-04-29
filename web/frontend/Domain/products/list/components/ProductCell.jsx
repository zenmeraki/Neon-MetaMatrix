import React, { memo, useCallback, useState } from "react";
import {
  InlineStack,
  Box,
  Button,
  Thumbnail,
  Text,
  Tooltip,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

function ProductCellComponent({ title = "", handle = "", imageUrl = "" }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const productTitle = title?.trim() || "Untitled product";
  const cleanHandle = handle?.trim() || "";
  const productHandle = cleanHandle ? `/${cleanHandle}` : "";

  const copyHandle = useCallback(
    async (event) => {
      event.stopPropagation();

      if (!cleanHandle) return;

      try {
        await navigator.clipboard.writeText(cleanHandle);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        setCopied(false);
      }
    },
    [cleanHandle]
  );

  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Box minWidth="40px" width="40px">
        <Thumbnail source={imageUrl || ""} alt="" size="small" />
      </Box>

      <Box minWidth="0" maxWidth="320px">
        <Tooltip content={productTitle}>
          <Text as="span" fontWeight="medium" truncate>
            {productTitle}
          </Text>
        </Tooltip>

        {productHandle ? (
          <Tooltip
            content={
              copied
                ? t("copiedHandle", { defaultValue: "Copied handle" })
                : t("copyHandle", { defaultValue: "Copy handle" })
            }
          >
            <Button
              variant="plain"
              onClick={copyHandle}
              accessibilityLabel={t("copyProductHandleAccessibilityLabel", {
                handle: cleanHandle,
                defaultValue: `Copy product handle ${cleanHandle}`,
              })}
            >
              <Text as="span" tone="subdued" variant="bodySm" truncate>
                {productHandle}
              </Text>
            </Button>
          </Tooltip>
        ) : null}
      </Box>
    </InlineStack>
  );
}

const ProductCell = memo(ProductCellComponent);

export default ProductCell;
