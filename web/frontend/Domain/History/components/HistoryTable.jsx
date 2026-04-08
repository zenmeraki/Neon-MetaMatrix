import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTable,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  Text,
  Box,
  EmptyState,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  Divider,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import AlertUndo from "../../products/edit/components/AlertUndo";
import useProductSyncStatus from "../../../hooks/useProductSyncStatus";

function getPrimaryStatusSummary(item) {
  if (item?.primaryStatus) {
    return item.primaryStatus;
  }

  const status = String(item?.status || "pending").toLowerCase();


  if (status === "completed") {
    return {
      key: "completed",
      label: "Completed",
      tone: "success",
      isTerminal: true,
    };
  }

  if (status === "failed") {
    return {
      key: "failed",
      label: "Failed",
      tone: "critical",
      isTerminal: true,
    };
  }

  if (status === "processing") {
    return {
      key: "processing",
      label: "Processing",
      tone: "info",
      isTerminal: false,
    };
  }

  return {
    key: "pending",
    label: "Pending",
    tone: "attention",
    isTerminal: false,
  };
}

function getUndoStatusSummary(item) {
  if (item?.undoStatusSummary) {
    return item.undoStatusSummary;
  }

  const undoStatus = String(item?.undo?.status || "").toLowerCase();

  if (!undoStatus || undoStatus === "idle") {
    return null;
  }

  if (undoStatus === "completed") {
    return {
      key: "undo_completed",
      label: "Undo completed",
      tone: "success",
      isTerminal: true,
    };
  }

  if (undoStatus === "failed") {
    return {
      key: "undo_failed",
      label: "Undo failed",
      tone: "critical",
      isTerminal: true,
    };
  }

  return {
    key: "undo_processing",
    label: "Undo processing",
    tone: "attention",
    isTerminal: false,
  };
}

function isActiveStatus(summary) {
  return Boolean(summary) && summary.isTerminal !== true;
}

const HistoryTable = memo(function HistoryTable({
  histories,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  emptyStateMessage = "No history items found.",
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isSyncInProgress } = useProductSyncStatus();

  const [showUndoModal, setShowUndoModal] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoHistoryItem, setUndoHistoryItem] = useState(null);
  const [localHistories, setLocalHistories] = useState(() => histories || []);

  useEffect(() => {
    setLocalHistories(histories || []);
  }, [histories]);

  const handleCloseUndo = useCallback(() => {
    setShowUndoModal(false);
    setUndoHistoryItem(null);
  }, []);

  const renderStatusBadge = useCallback((item) => {
    const primaryStatus = getPrimaryStatusSummary(item);
    const undoStatus = getUndoStatusSummary(item);

    return (
      <InlineStack gap="150" wrap>
        <Badge tone={primaryStatus.tone}>{primaryStatus.label}</Badge>
        {undoStatus ? <Badge tone={undoStatus.tone}>{undoStatus.label}</Badge> : null}
      </InlineStack>
    );
  }, []);

  const canUndo = useCallback((item) => {
    const primaryStatus = getPrimaryStatusSummary(item);
    const undoStatus = item?.undo?.status ?? item?.undoStatusSummary?.key ?? "idle";
    const isAllowed = item?.undo == null ? true : item.undo.allowed === true;

    return (
      primaryStatus.key === "completed" &&
      isAllowed &&
      ["idle", "failed", "undo_failed"].includes(String(undoStatus))
    );
  }, []);

  const handleUndo = useCallback((history) => {
    setUndoHistoryItem(history);
    setShowUndoModal(true);
  }, []);

  const handleUndoEditHistory = useCallback(async () => {
    if (!undoHistoryItem?.id) return;

    setUndoLoading(true);

    try {
      const response = await fetch(`/api/products/undo-edit/${undoHistoryItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return;
      }

      setLocalHistories((prev) =>
        prev.map((history) =>
          history.id === undoHistoryItem.id
            ? {
              ...history,
              undo: {
                ...history.undo,
                status: "processing",
                state: "queued",
                startedAt: new Date().toISOString(),
              },
              undoStatusSummary: {
                key: "undo_queued",
                label: "Undo queued",
                tone: "attention",
                isTerminal: false,
              },
            }
            : history,
        ),
      );

      setShowUndoModal(false);
      setUndoHistoryItem(null);
    } finally {
      setUndoLoading(false);
    }
  }, [undoHistoryItem]);

  const activeHistoryIds = useMemo(() => {
    return (localHistories || [])
      .filter((history) => {
        const primaryStatus = getPrimaryStatusSummary(history);
        const undoStatus = getUndoStatusSummary(history);
        return isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);
      })
      .map((history) => history.id)
      .filter(Boolean);
  }, [localHistories]);

  useEffect(() => {
    if (activeHistoryIds.length === 0) {
      return undefined;
    }

    const interval = setInterval(async () => {
      try {
        const updates = await Promise.all(
          activeHistoryIds.map((id) =>
            fetch(`/api/history/get-edit-history-details/${id}`)
              .then((response) => (response.ok ? response.json() : null))
              .then((json) => json?.data || null)
              .catch(() => null),
          ),
        );

        const updateMap = new Map(
          updates.filter(Boolean).map((entry) => [entry.id, entry]),
        );

        if (updateMap.size === 0) {
          return;
        }

        setLocalHistories((prev) =>
          prev.map((history) => {
            const updated = updateMap.get(history.id);
            return updated ? { ...history, ...updated } : history;
          }),
        );
      } catch {
        // silent polling failure
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeHistoryIds]);

  const summary = useMemo(() => {
    const items = localHistories || [];

    const total = items.length;
    const processing = items.filter((item) => {
      const primaryStatus = getPrimaryStatusSummary(item);
      const undoStatus = getUndoStatusSummary(item);
      return isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);
    }).length;

    const completed = items.filter(
      (item) => getPrimaryStatusSummary(item).key === "completed",
    ).length;

    const failed = items.filter(
      (item) => getPrimaryStatusSummary(item).key === "failed",
    ).length;

    return {
      total,
      processing,
      completed,
      failed,
    };
  }, [localHistories]);

  const rows = useMemo(() => {
    return (localHistories || []).map((item) => {
      const { id, title, shop } = item;
      const user = shop?.split(".")[0];

      const isUndoable = canUndo(item);
      const primaryStatus = getPrimaryStatusSummary(item);
      const undoStatus = getUndoStatusSummary(item);
      const isProcessing = isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);

      const undoDisabled = !isUndoable || isProcessing || isSyncInProgress;

      const progressLabel =
        item?.progressSummary?.label ||
        `${item?.processedCount || 0} / ${item?.totalItems || item?.processedCount || 0}`;

      const timeValue =
        isActiveStatus(undoStatus) && item?.undo?.startedAt
          ? item.undo.startedAt
          : undoStatus?.key === "undo_completed" && item?.undo?.completedAt
            ? item.undo.completedAt
            : item?.completedAt || item?.updatedAt || item?.editTime;

      return [
        <Box key={`title-${id}`} maxWidth="320px">
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="medium" truncate as="span">
              {title || "-"}
            </Text>
            <Text variant="bodySm" tone="subdued" as="span">
              {user || "-"}
            </Text>
          </BlockStack>
        </Box>,

        renderStatusBadge(item),

        <BlockStack key={`processed-${id}`} gap="050">
          <Text variant="bodyMd" as="span">
            {progressLabel}
          </Text>
          {primaryStatus.detail ? (
            <Text variant="bodySm" tone="subdued" as="span">
              {primaryStatus.detail}
            </Text>
          ) : null}
        </BlockStack>,

        <Text key={`updated-${id}`} as="span" variant="bodySm">
          {timeValue ? new Date(timeValue).toLocaleString() : "-"}
        </Text>,

        <InlineStack key={`actions-${id}`} gap="200" wrap={false}>
          <Button size="slim" onClick={() => navigate(`/editDetails/${id}`)}>
            {t("historyViewButton",)}
          </Button>
          <Button
            size="slim"
            tone={isUndoable ? "critical" : undefined}
            onClick={() => {
              if (isUndoable) {
                handleUndo(item);
              }
            }}
            disabled={undoDisabled}
          >
            {t("historyUndoButton",)}
          </Button>
        </InlineStack>,
      ];
    });
  }, [localHistories, canUndo, isSyncInProgress, navigate, renderStatusBadge, handleUndo]);

  if (isLoading) {
    return (
      <Card padding="0">
        <Box padding="500">
          <BlockStack gap="400">
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={2} />
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <SkeletonBodyText lines={6} />
            </BlockStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  if (!localHistories || localHistories.length === 0) {
    return (
      <Card>
        <Box padding="1200">
          <EmptyState heading="No activity yet">
            <p>{emptyStateMessage}</p>
          </EmptyState>
        </Box>
      </Card>
    );
  }

  return (
    <Card padding="0">
      <Box padding="500">
        <BlockStack gap="500">
          <InlineStack align="space-between" blockAlign="start" wrap gap="300">
            <BlockStack gap="100">
              <Box paddingInlineStart="500">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">
                    {t("historyEditActivityTitle",)}
                  </Text>

                  <Text tone="subdued" variant="bodySm">
                    {t("historyEditActivityText",)}
                  </Text>

                  {isSyncInProgress ? (
                    <Text tone="subdued" variant="bodySm">
                      {t("historyUndoDisabledSync",)}
                    </Text>
                  ) : null}
                </BlockStack>
              </Box>
            </BlockStack>

            <InlineStack gap="200" wrap>
              <Badge>{summary.total} {t("historySummaryTotal")}</Badge>
              <Badge tone="info">{summary.processing} {t("historySummaryActive")}</Badge>
              <Badge tone="success">{summary.completed} {t("historySummaryCompleted")}</Badge>
              <Badge tone="critical">{summary.failed} {t("historySummaryFailed")}</Badge>
            </InlineStack>
          </InlineStack>

          <InlineStack align="space-between" blockAlign="center" wrap gap="300">
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
              paddingInlineStart="800"
            >
              <Text tone="subdued" variant="bodySm" as="p">
                {t("historyLiveStatusHint",)}
              </Text>
            </Box>

            <Text tone="subdued" variant="bodySm">
              {localHistories.length}  {t("historyItemsCount")}
            </Text>
          </InlineStack>
        </BlockStack>
      </Box>

      <Divider />

      <Box overflowX="auto" paddingInlineStart="800">
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={[
            t("historyColumnTitle"),
            t("historyColumnStatus"),
            t("historyColumnProcessed"),
            t("historyColumnUpdated"),
            t("historyColumnActions"),
          ]}
          rows={rows}
        />
      </Box>
      {hasMore ? (
        <>
          <Divider />
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center" wrap gap="300">
              <Text tone="subdued" variant="bodySm">
                {t("historyLoadMoreHint",)}
              </Text>

              <Button loading={isLoadingMore} onClick={onLoadMore}>
                {t("historyLoadMoreButton",)}
              </Button>
            </InlineStack>
          </Box>
        </>
      ) : null}

      <AlertUndo
        show={showUndoModal}
        handleClose={handleCloseUndo}
        undoEditHistory={handleUndoEditHistory}
        loading={undoLoading}
      />
    </Card>
  );
});

HistoryTable.displayName = "HistoryTable";

export default HistoryTable;