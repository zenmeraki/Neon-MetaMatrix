import React, { memo, useCallback, useMemo, useState } from "react";
import { ActionList, Box, Button, Popover, Tooltip } from "@shopify/polaris";
import { MenuHorizontalIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const ProductRowActions = memo(function ProductRowActions({
  product,
  visible = false,
  onView,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const title = product?.title || t("product", { defaultValue: "Product" });
  const shouldRenderAction = visible || active;

  const close = useCallback(() => {
    setActive(false);
  }, []);

  const runAction = useCallback(
    (action) => {
      action?.(product);
      close();
    },
    [close, product]
  );

  const actionItems = useMemo(
    () => [
      {
        content: t("viewProduct", { defaultValue: "View product" }),
        disabled: !onView,
        onAction: () => runAction(onView),
      },
      {
        content: t("editProduct", { defaultValue: "Edit product" }),
        disabled: !onEdit,
        onAction: () => runAction(onEdit),
      },
      {
        content: t("duplicate", { defaultValue: "Duplicate" }),
        disabled: !onDuplicate,
        onAction: () => runAction(onDuplicate),
      },
      {
        content: t("archive", { defaultValue: "Archive" }),
        disabled: !onArchive,
        onAction: () => runAction(onArchive),
      },
      {
        content: t("delete", { defaultValue: "Delete" }),
        destructive: true,
        disabled: !onDelete,
        onAction: () => runAction(onDelete),
      },
    ],
    [onArchive, onDelete, onDuplicate, onEdit, onView, runAction, t]
  );

  return (
    <Box
      minWidth="44px"
      width="44px"
      onClick={(event) => event.stopPropagation()}
    >
      {shouldRenderAction ? (
        <Popover
          active={active}
          autofocusTarget="first-node"
          onClose={close}
          activator={
            <Tooltip
              content={t("moreActions", { defaultValue: "More actions" })}
            >
              <Button
                icon={MenuHorizontalIcon}
                variant="plain"
                onClick={() => setActive((value) => !value)}
                accessibilityLabel={t("moreProductActionsAccessibilityLabel", {
                  title,
                  defaultValue: `More actions for ${title}`,
                })}
              />
            </Tooltip>
          }
        >
          <ActionList items={actionItems} />
        </Popover>
      ) : null}
    </Box>
  );
});

export default ProductRowActions;
