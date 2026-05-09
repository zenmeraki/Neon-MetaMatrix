import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Card,
  InlineGrid,
  Layout,
  Page,
  Box,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import CatalogStatusCard from "../components/CatalogStatusCard";
import DashboardBanners from "../components/DashboardBanners";
import DashboardJobsCard from "../components/DashboardJobsCard";
import DashboardMetrics from "../components/DashboardMetrics";
import DashboardRefreshStatus from "../components/DashboardRefreshStatus";
import GenericErrorFallback from "../components/GenericErrorFallback";
import RecentActivityCard from "../components/RecentActivityCard";
import DashboardSkeleton from "../components/DashboardSkeleton";
import { useStoreAccess } from "../hooks/useStoreAccess";
import {
  formatDashboardNumber,
  getDashboardActionGuards,
  normalizeDashboardState,
} from "../utils/normalizeStoreAccess";

const DashboardOnboarding = lazy(() =>
  import("../components/DashboardOnboarding")
);
const PlanUsageCard = lazy(() => import("../components/PlanUsageCard"));
const QuickActionsGrid = lazy(() => import("../components/QuickActionsGrid"));
const MemoizedMetrics = memo(DashboardMetrics);
const MemoizedJobs = memo(DashboardJobsCard);
const MemoizedQuickActions = memo(QuickActionsGrid);

function DeferredSection({ active, minHeight = "0px", children }) {
  return (
    <Box minHeight={minHeight}>
      {active ? children : null}
    </Box>
  );
}

function JobsSkeleton() {
  return (
    <Card>
      <Box padding="400">
        <SkeletonBodyText lines={3} />
      </Box>
    </Card>
  );
}

function BannerSkeleton() {
  return (
    <Card>
      <Box padding="300">
        <SkeletonBodyText lines={2} />
      </Box>
    </Card>
  );
}

const DashboardOnboardingSection = memo(function DashboardOnboardingSection() {
  const [showGuide, setShowGuide] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  return (
    <Suspense fallback={<Box minHeight="160px" />}>
      <DashboardOnboarding
        showGuide={showGuide}
        showVideo={showVideo}
        onToggleGuide={() => setShowGuide((v) => !v)}
        onWatchDemo={() => setShowVideo(true)}
      />
    </Suspense>
  );
});

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

const RefreshSection = memo(function RefreshSection({
  lastFetchedAt,
  loadingStoreData,
  onRefresh,
}) {
  return (
    <Layout.Section>
      <DashboardRefreshStatus
        lastFetchedAt={lastFetchedAt}
        loading={loadingStoreData}
        onRefresh={onRefresh}
      />
    </Layout.Section>
  );
});

const BannerSection = memo(function BannerSection({
  hasDashboardBanners,
  showFreeAccessBanner,
  isCreditAvailable,
  isSyncing,
  syncFeedback,
  onDismissFreeAccess,
  onRequestExtension,
  onViewProgress,
}) {
  return (
    <Layout.Section>
      <DeferredSection active={hasDashboardBanners} minHeight="92px">
        {hasDashboardBanners ? (
          <DashboardBanners
            showFreeAccessBanner={showFreeAccessBanner}
            isCreditAvailable={isCreditAvailable}
            isSyncing={isSyncing}
            syncFeedback={syncFeedback}
            onDismissFreeAccess={onDismissFreeAccess}
            onRequestExtension={onRequestExtension}
            onViewProgress={onViewProgress}
          />
        ) : (
          <BannerSkeleton />
        )}
      </DeferredSection>
    </Layout.Section>
  );
});

const JobsSection = memo(function JobsSection({
  hasJobs,
  jobs,
  onViewJob,
  onRetryJob,
  onCopyDiagnostic,
}) {
  return (
    <Layout.Section>
      <DeferredSection active={hasJobs} minHeight="84px">
        {hasJobs ? (
          <MemoizedJobs
            jobs={jobs}
            onViewJob={onViewJob}
            onRetryJob={onRetryJob}
            onCopyDiagnostic={onCopyDiagnostic}
          />
        ) : (
          <JobsSkeleton />
        )}
      </DeferredSection>
    </Layout.Section>
  );
});

const CoreGridSection = memo(function CoreGridSection({
  catalogCard,
  loadingStoreData,
  bulkEdits,
  exports,
  imports,
  storeStatusLabel,
  onFirstEdit,
  onImport,
  editDisabled,
  deferredSectionsReady,
  plan,
  dashboardState,
  onViewHistory,
  onStartEditing,
}) {
  const { t } = useTranslation();
  const recentActivities = useMemo(
    () => buildRecentActivities({ dashboardState, t }).slice(0, 8),
    [dashboardState, t]
  );

  return (
    <Layout.Section>
      <InlineGrid
        columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}
        gap="400"
        alignItems="stretch"
      >
        {catalogCard}
        <MemoizedMetrics
          loading={loadingStoreData}
          bulkEdits={bulkEdits}
          exports={exports}
          imports={imports}
          storeStatusLabel={storeStatusLabel}
          onFirstEdit={onFirstEdit}
          onImport={onImport}
          onWatchDemo={onFirstEdit}
          editDisabled={editDisabled}
        />
        <DeferredSection active={deferredSectionsReady} minHeight="220px">
          <Suspense fallback={<Box minHeight="220px" />}>
            <PlanUsageCard
              currentEditCount={plan.currentEditCount}
              maxEdits={plan.maxEdits}
              planName={plan.planName}
              status={plan.status}
              usageLabel={plan.usageLabel}
              usagePercent={plan.usagePercent}
            />
          </Suspense>
        </DeferredSection>
        <RecentActivityCard
          activities={recentActivities}
          onViewHistory={onViewHistory}
          onStartEditing={onStartEditing}
        />
      </InlineGrid>
    </Layout.Section>
  );
});

const QuickActionsSection = memo(function QuickActionsSection({
  deferredSectionsReady,
  dashboardState,
  actionGuards,
  actionLocked,
  pendingActionKey,
  runNavigationAction,
  goEdit,
  goExport,
  goImport,
  goSnippets,
}) {
  const { t } = useTranslation();
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

  return (
    <Layout.Section>
      <DeferredSection active={deferredSectionsReady} minHeight="180px">
        <Suspense fallback={<Box minHeight="180px" />}>
          <MemoizedQuickActions actions={quickActions} />
        </Suspense>
      </DeferredSection>
    </Layout.Section>
  );
});

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const app = useAppBridge();
  const fetchWithAuth = useAuthenticatedFetch();
  const {
    data: storeAccess,
    loading: loadingStoreData,
    error: storeAccessError,
    lastFetchedAt,
    refetch,
  } = useStoreAccess();
  const [showFreeAccessBanner, setShowFreeAccessBanner] = useState(true);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [pendingActionKey, setPendingActionKey] = useState(null);
  const [deferredSectionsReady, setDeferredSectionsReady] = useState(false);
  const refreshInFlightRef = useRef(false);
  const recentToastRef = useRef(new Map());

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

  const showToastDeduped = useCallback(
    (message, options = {}, dedupeMs = 1500) => {
      if (!message) return;
      const key = `${message}:${Boolean(options?.isError)}`;
      const now = Date.now();
      const lastAt = recentToastRef.current.get(key) || 0;
      if (now - lastAt < dedupeMs) return;
      recentToastRef.current.set(key, now);
      app.toast.show(message, options);
    },
    [app.toast]
  );

  const dismissFreeAccessBanner = useCallback(() => {
    setShowFreeAccessBanner(false);
  }, []);

  useEffect(() => {
    const run = () => setDeferredSectionsReady(true);
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 800 });
      return () => window.cancelIdleCallback(id);
    }
    const timeoutId = window.setTimeout(run, 200);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (pendingActionKey) {
      setPendingActionKey(null);
    }
  }, [location.pathname, pendingActionKey]);

  const handleRefreshDashboard = useCallback(() => {
    if (refreshInFlightRef.current) {
      return Promise.resolve();
    }
    refreshInFlightRef.current = true;
    return refetch({ forceRefresh: true })
      .catch(() => {})
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [refetch]);

  const handleCopyDiagnostic = useCallback(
    async (diagnosticId) => {
      if (!diagnosticId) return;
      try {
        await navigator.clipboard.writeText(diagnosticId);
        showToastDeduped(t("diagnosticCopied", "Diagnostic ID copied"), {
          duration: 2000,
        });
      } catch {
        showToastDeduped(
          t("diagnosticCopyFailed", "Could not copy diagnostic ID"),
          { duration: 3000, isError: true }
        );
      }
    },
    [showToastDeduped, t]
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
      showToastDeduped(t("syncStarted", "Sync started"), { duration: 3000 });
      setSyncFeedback("started");
      await refetch({ forceRefresh: true });
    } catch {
      setSyncFeedback("failed");
    } finally {
      setSyncSubmitting(false);
    }
  }, [
    actionGuards.syncCatalog.disabled,
    showToastDeduped,
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
        showToastDeduped(toastMessage, { duration: 2000 });
      }
      action();
      setPendingActionKey(null);
    },
    [pendingActionKey, showToastDeduped, syncSubmitting]
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

  if (loadingStoreData && !storeAccess) {
    return (
      <Page fullWidth title={t("dashboard", "Dashboard")}>
        <DashboardSkeleton loadingLabel={t("loadingDashboard", "Loading dashboard")} />
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
      trustState={dashboardState.catalog.trustState}
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
        <RefreshSection
          lastFetchedAt={lastFetchedAt}
          loadingStoreData={loadingStoreData}
          onRefresh={handleRefreshDashboard}
        />

        <BannerSection
          hasDashboardBanners={hasDashboardBanners}
          showFreeAccessBanner={showFreeAccessBanner}
          isCreditAvailable={dashboardState.isCreditAvailable}
          isSyncing={isSyncing}
          syncFeedback={syncFeedback}
          onDismissFreeAccess={dismissFreeAccessBanner}
          onRequestExtension={goSuggestions}
          onViewProgress={goRefresh}
        />

        <JobsSection
          hasJobs={hasJobs}
          jobs={dashboardState.jobs}
          onViewJob={goRefresh}
          onRetryJob={handleSyncNow}
          onCopyDiagnostic={(job) => handleCopyDiagnostic(job.diagnosticId)}
        />

        <CoreGridSection
          catalogCard={catalogCard}
          loadingStoreData={loadingStoreData}
          bulkEdits={dashboardState.metrics.bulkEdits}
          exports={dashboardState.metrics.exports}
          imports={dashboardState.metrics.imports}
          storeStatusLabel={getStoreStatusLabel(dashboardState.catalog.status, t)}
          onFirstEdit={actionGuards.bulkEdit.disabled ? handleSyncNow : goEdit}
          onImport={goImport}
          editDisabled={actionGuards.bulkEdit.disabled}
          deferredSectionsReady={deferredSectionsReady}
          plan={dashboardState.plan}
          dashboardState={dashboardState}
          onViewHistory={goHistory}
          onStartEditing={actionGuards.bulkEdit.disabled ? handleSyncNow : goEdit}
        />

        <QuickActionsSection
          deferredSectionsReady={deferredSectionsReady}
          dashboardState={dashboardState}
          actionGuards={actionGuards}
          actionLocked={actionLocked}
          pendingActionKey={pendingActionKey}
          runNavigationAction={runNavigationAction}
          goEdit={goEdit}
          goExport={goExport}
          goImport={goImport}
          goSnippets={goSnippets}
        />

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
          <DeferredSection active={deferredSectionsReady} minHeight="160px">
            <DashboardOnboardingSection />
          </DeferredSection>
        </Layout.Section>

        {/* Bottom breathing room */}
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
