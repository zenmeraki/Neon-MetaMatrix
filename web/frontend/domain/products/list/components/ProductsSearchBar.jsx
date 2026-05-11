import React, { memo, useCallback, useEffect, useState } from "react";
import { Box, Button, InlineStack, TextField } from "@shopify/polaris";
import { MagicIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const ProductsSearchBar = memo(function ProductsSearchBar({
  value = "",
  onSubmit,
  onClear,
}) {
  const { t } = useTranslation();
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const handleSubmit = useCallback(() => {
    onSubmit(draftValue);
  }, [draftValue, onSubmit]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter") {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleClear = useCallback(() => {
    setDraftValue("");
    onClear();
  }, [onClear]);

  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Box width="44px" minWidth="44px">
        <Button
          fullWidth
          icon={MagicIcon}
          onClick={handleSubmit}
          accessibilityLabel={t("searchAssistantAccessibilityLabel", {
            defaultValue: "AI search",
          })}
        />
      </Box>

      <Box width="100%">
        <TextField
          label={t("searchProducts", { defaultValue: "Search products" })}
          labelHidden
          value={draftValue}
          placeholder={t("searchAndPressEnter", {
            defaultValue: "Search and press enter",
          })}
          onChange={setDraftValue}
          onKeyDown={handleKeyDown}
          clearButton
          onClearButtonClick={handleClear}
          autoComplete="off"
        />
      </Box>
    </InlineStack>
  );
});

export default ProductsSearchBar;
