import { useCallback, useMemo, useState } from "react";
import { InlineGrid, Layout, Page,Box } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import CatalogStatusCard from "../components/CatalogStatusCard";
import DashboardBanners from "../components/DashboardBanners";
import DashboardJobsCard from "../components/DashboardJobsCard";
import DashboardMetrics from "../components/DashboardMetrics";
import DashboardOnboarding from "../components/DashboardOnboarding";
import DashboardRefreshStatus from "../components/DashboardRefreshStatus";
import GenericErrorFallback from "../components/GenericErrorFallback";
import PlanUsageCard from "../components/PlanUsageCard";
import QuickActionsGrid from "../components/QuickActionsGrid";
import RecentActivityCard from "../components/RecentActivityCard";
import { useStoreAccess } from "../hooks/useStoreAccess";
import {
  formatDashboardNumber,
  getDashboardActionGuards,
  normalizeDashboardState,
} from "../utils/normalizeStoreAccess";

function buildRecentActivities({ dashboardState, t }) {
  if (dashboardState.activity.length > 0) return dashboardState.activity;

  if (
    dashboardState.catalog.status === "not_synced" &&
    dashboardState.hasNoOperationalActivity
  ) {
    return [];
  }

  return [
    dashboardState.catalog.productCount > 0 && {
      id: "sync-completed",
      type: "sync",
      title: t("syncCompleted", "Product sync completed"),
      description: t("productsSyncedCount", "{{count}} products", {
        count: formatDashboardNumber(dashboardState.catalog.productCount),
      }),
    },
    dashboardState.metrics.bulkEdits > 0 && {
      id: "bulk-edit-summary",
      type: "edit",
      title: t("bulkEditActivity", "Bulk edits completed"),
      description: t("bulkEditsCount", "{{count}} edits", {
        count: formatDashboardNumber(dashboardState.metrics.bulkEdits),
      }),
    },
    dashboardState.metrics.exports > 0 && {
      id: "export-summary",
      type: "export",
      title: t("exportsReady", "Exports ready"),
      description: t("exportsCount", "{{count}} exports", {
        count: formatDashboardNumber(dashboardState.metrics.exports),
      }),
    },
  ].filter(Boolean);
}

function getStoreStatusLabel(status, t) {
  const labels = {
    not_synced: t("notSynced", "Not synced"),
    initial_sync_running: t("syncing", "Syncing"),
    ready: t("ready", "Ready"),
    stale: t("stale", "Stale"),
    failed: t("failed", "Failed"),
    inconsistent: t("inconsistent", "Inconsistent"),
  };

  return labels[status] ?? labels.not_synced;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useAppBridge();
  const fetchWithAuth = useAuthenticatedFetch();
  const {
    data: storeAccess,
    loading: loadingStoreData,
    error: storeAccessError,
    lastFetchedAt,
    refetch,
  } = useStoreAccess();
  const [showGuide, setShowGuide] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showFreeAccessBanner, setShowFreeAccessBanner] = useState(true);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [pendingActionKey, setPendingActionKey] = useState(null);

  const dashboardState = useMemo(
    () => normalizeDashboardState(storeAccess),
    [storeAccess]
  );
  const actionGuards = useMemo(
    () => getDashboardActionGuards(dashboardState),
    [dashboardState]
  );
  const isSyncing =
    dashboardState.catalog.status === "initial_sync_running" || syncSubmitting;
  const actionLocked = Boolean(pendingActionKey) || syncSubmitting;
  const isLargeStore = dashboardState.storeSize === "large";
  const hasJobs =
    dashboardState.jobs.active.length > 0 ||
    dashboardState.jobs.failed.length > 0;
  const hasDashboardBanners =
    (showFreeAccessBanner && dashboardState.isCreditAvailable) ||
    isSyncing ||
    syncFeedback;

  const goEdit = useCallback(() => navigate("/edit"), [navigate]);
  const goExport = useCallback(() => navigate("/exportdata"), [navigate]);
  const goImport = useCallback(() => navigate("/spreadsheet"), [navigate]);
  const goHistory = useCallback(() => navigate("/history"), [navigate]);
  const goRefresh = useCallback(() => navigate("/refresh"), [navigate]);
  const goSnippets = useCallback(() => navigate("/product-code-snippets"), [navigate]);
  const goSuggestions = useCallback(() => navigate("/suggestionpage"), [navigate]);

  const handleRefreshDashboard = useCallback(() => {
    return refetch({ forceRefresh: true }).catch(() => {});
  }, [refetch]);

  const handleCopyDiagnostic = useCallback(
    async (diagnosticId) => {
      if (!diagnosticId) return;
      try {
        await navigator.clipboard.writeText(diagnosticId);
        app.toast.show(t("diagnosticCopied", "Diagnostic ID copied"), {
          duration: 2000,
        });
      } catch {
        app.toast.show(
          t("diagnosticCopyFailed", "Could not copy diagnostic ID"),
          { duration: 3000, isError: true }
        );
      }
    },
    [app.toast, t]
  );

  const handleSyncNow = useCallback(async () => {
    if (syncSubmitting || actionGuards.syncCatalog.disabled) return;

    setSyncSubmitting(true);
    setSyncFeedback(null);

    try {
      const response = await fetchWithAuth("/api/sync/products");
      if (!response?.ok) {
        throw new Error(t("syncStartFailed", "Unable to start product sync."));
      }
      app.toast.show(t("syncStarted", "Sync started"), { duration: 3000 });
      setSyncFeedback("started");
      await refetch({ forceRefresh: true });
    } catch {
      setSyncFeedback("failed");
    } finally {
      setSyncSubmitting(false);
    }
  }, [
    actionGuards.syncCatalog.disabled,
    app.toast,
    fetchWithAuth,
    refetch,
    syncSubmitting,
    t,
  ]);

  const runNavigationAction = useCallback(
    (key, action, toastMessage) => {
      if (pendingActionKey || syncSubmitting) return;
      setPendingActionKey(key);
      if (toastMessage) {
        app.toast.show(toastMessage, { duration: 2000 });
      }
      action();
      window.setTimeout(() => {
        setPendingActionKey((currentKey) =>
          currentKey === key ? null : currentKey
        );
      }, 800);
    },
    [app.toast, pendingActionKey, syncSubmitting]
  );

  const dashboardTotals = useMemo(
    () => ({
      bulkEdits: dashboardState.metrics.bulkEdits,
      exports: dashboardState.metrics.exports,
      imports: dashboardState.metrics.imports,
    }),
    [
      dashboardState.metrics.bulkEdits,
      dashboardState.metrics.exports,
      dashboardState.metrics.imports,
    ]
  );

  const recentActivities = useMemo(
    () => buildRecentActivities({ dashboardState, t }),
    [dashboardState, t]
  );

  const quickActions = useMemo(
    () => [
      {
        key: "edit-products",
        icon: PlusIcon,
        title: t("editProducts", "Edit products"),
        description: "",
        actionText: dashboardState.catalog.canPreview
          ? t("previewProducts", "Preview products")
          : t("startEditing", "Start editing"),
        primary: true,
        disabled: false,
        disabledReason: null,
        loading: pendingActionKey === "edit-products",
        trustCopy: t(
          dashboardState.catalog.canPreview && !dashboardState.catalog.canExecute
            ? "bulkEditPreviewOnlyTrustCopy"
            : "bulkEditTrustCopy",
          dashboardState.catalog.canPreview && !dashboardState.catalog.canExecute
            ? "Preview changes now. Applying edits is blocked until sync is ready."
            : "Preview changes before applying. Undo available after edit."
        ),
        requiresPlan: actionGuards.bulkEdit.requiresPlan,
        requiresSyncedCatalog: actionGuards.bulkEdit.requiresSyncedCatalog,
        onAction: () =>
          runNavigationAction(
            "edit-products",
            goEdit,
            t("openingEditProducts", "Opening edit workflow")
          ),
      },
      {
        key: "export-products",
        icon: ExportIcon,
        title: t("exportProducts", "Export products"),
        description: t(
          "exportProductsTaskDescription",
          "Export product and variant data for reporting or review."
        ),
        actionText: t("createExport", "Create export"),
        disabled: actionLocked || actionGuards.exportProducts.disabled,
        disabledReason: actionGuards.exportProducts.disabledReason,
        loading: pendingActionKey === "export-products",
        requiresPlan: actionGuards.exportProducts.requiresPlan,
        requiresSyncedCatalog: actionGuards.exportProducts.requiresSyncedCatalog,
        onAction: () =>
          runNavigationAction(
            "export-products",
            goExport,
            t("openingExportWorkflow", "Opening export workflow")
          ),
      },
      {
        key: "import-spreadsheet",
        icon: ImportIcon,
        title: t("importSpreadsheet", "Import spreadsheet"),
        description: t(
          "importSpreadsheetTaskDescription",
          "Upload spreadsheet changes and validate them before applying."
        ),
        actionText: t("openImport", "Open import"),
        disabled: actionLocked || actionGuards.importProducts.disabled,
        disabledReason: actionGuards.importProducts.disabledReason,
        loading: pendingActionKey === "import-spreadsheet",
        requiresPlan: actionGuards.importProducts.requiresPlan,
        requiresSyncedCatalog: actionGuards.importProducts.requiresSyncedCatalog,
        onAction: () =>
          runNavigationAction(
            "import-spreadsheet",
            goImport,
            t("openingImportWorkflow", "Opening import workflow")
          ),
      },
      {
        key: "snippet-studio",
        icon: ViewIcon,
        title: t("snippetStudio", "Snippet Studio"),
        description: t(
          "snippetStudioTaskDescription",
          "Create reusable snippets for repeated product workflows."
        ),
        actionText: t("openSnippetStudio", "Open Snippet Studio"),
        disabled: actionLocked || actionGuards.snippets.disabled,
        disabledReason: actionGuards.snippets.disabledReason,
        loading: pendingActionKey === "snippet-studio",
        requiresPlan: actionGuards.snippets.requiresPlan,
        requiresSyncedCatalog: actionGuards.snippets.requiresSyncedCatalog,
        onAction: () =>
          runNavigationAction(
            "snippet-studio",
            goSnippets,
            t("openingSnippetStudio", "Opening Snippet Studio")
          ),
      },
    ],
    [
      actionGuards,
      actionLocked,
      dashboardState.catalog.canExecute,
      dashboardState.catalog.canPreview,
      goEdit,
      goExport,
      goImport,
      goSnippets,
      pendingActionKey,
      runNavigationAction,
      t,
    ]
  );

  if (storeAccessError) {
    const error =
      storeAccessError instanceof Error
        ? storeAccessError
        : new Error(storeAccessError);

    return (
      <Page fullWidth title={t("dashboard", "Dashboard")}>
        <GenericErrorFallback
          error={error}
          resetErrorBoundary={handleRefreshDashboard}
        />
      </Page>
    );
  }

  const catalogCard = (
    <CatalogStatusCard
      status={dashboardState.catalog.status}
      canPreview={dashboardState.catalog.canPreview}
      canExecute={dashboardState.catalog.canExecute}
      disabledReason={dashboardState.catalog.disabledReason}
      products={dashboardState.catalog.productCount}
      variants={dashboardState.catalog.variantCount}
      lastSyncedAt={dashboardState.catalog.lastSyncedAt}
      staleReason={dashboardState.catalog.disabledReason}
      diagnosticId={dashboardState.catalog.diagnosticId}
      syncSubmitting={syncSubmitting}
      onSyncNow={handleSyncNow}
      onViewProgress={goRefresh}
      onCopyDiagnostic={() =>
        handleCopyDiagnostic(dashboardState.catalog.diagnosticId)
      }
    />
  );

  return (
    <Page
      fullWidth
      title={t("dashboard", "Dashboard")}
      subtitle={t("manageStoreOperations", "Manage store operations")}
      primaryAction={{
        content: t("editProducts", "Edit products"),
        icon: EditIcon,
        onAction: () =>
          runNavigationAction(
            "page-edit-products",
            goEdit,
            t("openingEditProducts", "Opening edit workflow")
          ),
        disabled: actionLocked || actionGuards.bulkEdit.disabled,
      }}
      secondaryActions={[
        {
          content: t("syncNow", "Sync now"),
          onAction: handleSyncNow,
          loading: syncSubmitting,
          disabled: syncSubmitting || actionGuards.syncCatalog.disabled,
        },
        {
          content: t("viewHistory", "View history"),
          onAction: goHistory,
        },
      ]}
    >
      <Layout>
        {/* Refresh status — inline, no card */}
        <Layout.Section>
          <DashboardRefreshStatus
            lastFetchedAt={lastFetchedAt}
            loading={loadingStoreData}
            onRefresh={handleRefreshDashboard}
          />
        </Layout.Section>

        {/* Banners */}
        {hasDashboardBanners ? (
          <Layout.Section>
            <DashboardBanners
              showFreeAccessBanner={showFreeAccessBanner}
              isCreditAvailable={dashboardState.isCreditAvailable}
              isSyncing={isSyncing}
              syncFeedback={syncFeedback}
              onDismissFreeAccess={() => setShowFreeAccessBanner(false)}
              onRequestExtension={goSuggestions}
              onViewProgress={goRefresh}
            />
          </Layout.Section>
        ) : null}

        {/* Active / failed jobs */}
        {hasJobs ? (
          <Layout.Section>
            <DashboardJobsCard
              jobs={dashboardState.jobs}
              onViewJob={goRefresh}
              onRetryJob={handleSyncNow}
              onCopyDiagnostic={(job) =>
                handleCopyDiagnostic(job.diagnosticId)
              }
            />
          </Layout.Section>
        ) : null}

        {/* 2x2 grid: Catalog, Metrics, Plan usage, Recent activity */}
        <Layout.Section>
          <InlineGrid
            columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}
            gap="400"
            alignItems="stretch"
          >
            {catalogCard}

            <DashboardMetrics
              loading={loadingStoreData}
              totals={dashboardTotals}
              storeStatusLabel={getStoreStatusLabel(
                dashboardState.catalog.status,
                t
              )}
              onFirstEdit={actionGuards.bulkEdit.disabled ? handleSyncNow : goEdit}
              onImport={goImport}
              onWatchDemo={() => setShowVideo(true)}
              editDisabled={actionGuards.bulkEdit.disabled}
            />

            <PlanUsageCard
              currentEditCount={dashboardState.plan.currentEditCount}
              maxEdits={dashboardState.plan.maxEdits}
              planName={dashboardState.plan.planName}
              status={dashboardState.plan.status}
              usageLabel={dashboardState.plan.usageLabel}
              usagePercent={dashboardState.plan.usagePercent}
            />

            <RecentActivityCard
              activities={recentActivities}
              onViewHistory={goHistory}
              onStartEditing={
                actionGuards.bulkEdit.disabled ? handleSyncNow : goEdit
              }
            />
          </InlineGrid>
        </Layout.Section>

        {/* Quick actions */}
        <Layout.Section>
          <QuickActionsGrid actions={quickActions} />
        </Layout.Section>

        {/* Undo available */}
        {dashboardState.undo.available ? (
          <Layout.Section>
            <RecentActivityCard
              activities={[
                {
                  id: "undo-available",
                  type: "edit",
                  title: t("undoAvailable", "Undo available"),
                  description: dashboardState.undo.label,
                },
              ]}
              onViewHistory={goHistory}
              onStartEditing={goHistory}
            />
          </Layout.Section>
        ) : null}

        {/* Onboarding */}
        <Layout.Section>
          <DashboardOnboarding
            showGuide={showGuide}
            showVideo={showVideo}
            onToggleGuide={() => setShowGuide((v) => !v)}
            onWatchDemo={() => setShowVideo(true)}
          />
        </Layout.Section>

        {/* Bottom breathing room */}
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}