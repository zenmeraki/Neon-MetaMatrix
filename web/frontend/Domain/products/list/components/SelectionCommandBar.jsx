import React, { memo, useMemo, useState } from "react";
import {
  ActionList,
  Banner,
  Box,
  Button,
  InlineStack,
  Popover,
  Select,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const SelectionCommandBar = memo(function SelectionCommandBar({
  selection,
  totalCount = 0,
  targetAction = "",
  onEdit,
  onExport,
  onViewSelection,
  onNarrowSelection,
  onSaveSegment,
}) {
  const { t, i18n } = useTranslation();
  const [popoverActive, setPopoverActive] = useState(false);

  const selectedLabel = Number(selection.selectedCount || 0).toLocaleString(
    i18n.language
  );
  const totalLabel = Number(totalCount || 0).toLocaleString(i18n.language);
  const excludedLabel = Number(selection.excludedCount || 0).toLocaleString(
    i18n.language
  );
  const disabled = Boolean(targetAction);

  const scopeOptions = useMemo(
    () => [
      {
        label: t("selectionScopePage", {
          defaultValue: `This page (${selection.pageCount})`,
        }),
        value: "page",
      },
      {
        label: t("selectionScopeAllResults", {
          count: totalCount,
          defaultValue: `All results (${totalLabel})`,
        }),
        value: "all_results",
      },
      {
        label: t("selectionScopeFilteredSubset", {
          defaultValue: "Only filtered subset",
        }),
        value: "filtered_subset",
      },
    ],
    [selection.pageCount, t, totalCount, totalLabel]
  );

  const actionItems = useMemo(
    () => [
      {
        content: t("viewSelection", { defaultValue: "View selection" }),
        onAction: () => {
          setPopoverActive(false);
          onViewSelection();
        },
        disabled,
      },
      {
        content: t("narrowSelection", { defaultValue: "Narrow selection" }),
        onAction: () => {
          setPopoverActive(false);
          onNarrowSelection();
        },
        disabled,
      },
      {
        content: t("saveSelectionAsSegment", {
          defaultValue: "Save selection as segment",
        }),
        onAction: () => {
          setPopoverActive(false);
          onSaveSegment();
        },
        disabled,
      },
      {
        content: t("exportSelection", { defaultValue: "Export selection" }),
        onAction: () => {
          setPopoverActive(false);
          onExport();
        },
        disabled,
      },
    ],
    [disabled, onExport, onNarrowSelection, onSaveSegment, onViewSelection, t]
  );

  const selectionText =
    selection.scope === "all_results"
      ? t("allResultsSelected", {
          count: totalCount,
          defaultValue: `${totalLabel} products selected`,
        })
      : selection.mode === "query"
      ? t("allMatchingProductsSelected", {
          count: selection.selectedCount,
          excluded: selection.excludedCount,
          defaultValue: `${selectedLabel} selected${
            selection.excludedCount > 0 ? ` (${excludedLabel} excluded)` : ""
          }`,
        })
      : t("pageProductsSelected", {
          count: selection.selectedCount,
          defaultValue: `${selectedLabel} selected`,
        });

  return (
    <Banner tone={selection.mode === "query" ? "success" : "info"}>
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Popover
            active={popoverActive}
            activator={
              <Button
                disclosure
                onClick={() => setPopoverActive((active) => !active)}
                disabled={disabled}
                accessibilityLabel={t("selectionCommandsAccessibilityLabel", {
                  defaultValue: "Open selection commands",
                })}
              >
                {selectionText}
              </Button>
            }
            autofocusTarget="first-node"
            onClose={() => setPopoverActive(false)}
          >
            <ActionList items={actionItems} />
          </Popover>

          <Box minWidth="220px">
            <Select
              label={t("bulkScope", { defaultValue: "Bulk scope" })}
              labelHidden
              options={scopeOptions}
              value={selection.scope}
              onChange={selection.setScope}
              disabled={disabled}
            />
          </Box>
        </InlineStack>

        <InlineStack gap="200" wrap>
          {selection.mode !== "query" &&
          selection.pageCount > 0 &&
          totalCount > selection.pageCount ? (
            <Button
              type="button"
              onClick={selection.selectAllMatching}
              disabled={disabled}
              accessibilityLabel={t(
                "selectAllMatchingProductsAccessibilityLabel",
                {
                  count: totalCount,
                  defaultValue: `Select all ${totalLabel} matching products`,
                }
              )}
            >
              {t("selectAllMatchingProducts", {
                count: totalCount,
                defaultValue: `Select all ${totalLabel}`,
              })}
            </Button>
          ) : null}

          <Button
            type="button"
            onClick={onEdit}
            loading={targetAction === "edit"}
            disabled={disabled}
            accessibilityLabel={t("editSelectedAccessibilityLabel", {
              defaultValue: "Edit selected products",
            })}
          >
            {t("edit", { defaultValue: "Edit" })}
          </Button>

          <Button
            type="button"
            onClick={onExport}
            loading={targetAction === "export"}
            disabled={disabled}
            accessibilityLabel={t("exportSelectedAccessibilityLabel", {
              defaultValue: "Export selected products",
            })}
          >
            {t("export", { defaultValue: "Export" })}
          </Button>

          <Button
            type="button"
            variant="plain"
            onClick={selection.clearSelection}
            disabled={disabled}
            accessibilityLabel={t("clearSelectionAccessibilityLabel", {
              defaultValue: "Clear product selection",
            })}
          >
            {t("clearSelection", {
              defaultValue: "Clear selection",
            })}
          </Button>
        </InlineStack>
      </InlineStack>
    </Banner>
  );
});

export default SelectionCommandBar;
