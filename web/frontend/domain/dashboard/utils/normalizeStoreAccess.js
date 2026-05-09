const numberFormatter = new Intl.NumberFormat();

export function formatDashboardNumber(value) {
  const number = Number(value ?? 0);
  return numberFormatter.format(Number.isFinite(number) ? number : 0);
}

export function formatDashboardDateTime(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function readNumber(...values) {
  const value = values.find((candidate) => candidate != null);
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function readBoolean(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCatalog(raw, { productCount, variantCount }) {
  const rawStatus = String(
    raw?.mirrorHealthState ?? raw?.catalogStatus ?? raw?.syncStatus ?? "",
  ).toLowerCase();
  const hasCatalogData = productCount > 0 || variantCount > 0;
  const syncRunId = raw?.syncRunId ?? raw?.currentSyncRunId ?? null;
  const mirrorBatchId = raw?.activeMirrorBatchId ?? raw?.mirrorBatchId ?? null;

  let status = "not_synced";

  if (
    raw?.repairRequired ||
    raw?.catalogSnapshotConsistent === false ||
    ["unsafe", "repair_required", "inconsistent"].includes(rawStatus)
  ) {
    status = "inconsistent";
  } else if (
    ["error", "failed"].includes(rawStatus) ||
    raw?.catalogSnapshotError
  ) {
    status = "failed";
  } else if (
    raw?.isProductInitiallySyncing ||
    raw?.isProductInitialySyning ||
    rawStatus === "syncing"
  ) {
    status = "initial_sync_running";
  } else if (["stale", "warning", "needs_attention"].includes(rawStatus)) {
    status = "stale";
  } else if (hasCatalogData) {
    status = "ready";
  }

  const canPreview = ["ready", "stale"].includes(status);
  const canExecute = status === "ready";
  const disabledReason =
    status === "initial_sync_running"
      ? "Edit products unavailable until catalog sync completes."
      : status === "stale"
      ? "Preview is available, but applying edits is blocked until sync refreshes."
      : status === "failed"
      ? "Catalog sync failed. Retry sync before editing products."
      : status === "inconsistent"
      ? raw?.staleReason ||
        "Catalog mirror is inconsistent. Editing is disabled until repaired."
      : status === "not_synced"
      ? "Edit products unavailable until catalog sync completes."
      : null;

  return {
    status,
    canPreview,
    canExecute,
    disabledReason,
    productCount,
    variantCount,
    lastSyncedAt: formatDashboardDateTime(
      raw?.lastProductSyncAt ?? raw?.lastSyncedAt,
    ),
    syncRunId,
    mirrorBatchId,
    diagnosticId:
      raw?.diagnosticId ??
      raw?.catalogDiagnosticId ??
      raw?.lastSyncErrorId ??
      null,
    trustState: {
      mirrorBatchId:
        raw?.trustState?.mirrorBatchId ??
        raw?.activeMirrorBatchId ??
        raw?.mirrorBatchId ??
        null,
      variantBatchStatus: raw?.trustState?.variantBatchStatus ?? "unknown",
      collectionBatchStatus: raw?.trustState?.collectionBatchStatus ?? "unknown",
      metafieldBatchStatus: raw?.trustState?.metafieldBatchStatus ?? "unknown",
      batchObservedAt:
        formatDashboardDateTime(raw?.trustState?.batchObservedAt) ?? null,
    },
  };
}

function normalizePermissions(raw) {
  const permissions =
    raw?.permissions ??
    raw?.staffPermissions ??
    raw?.currentUserPermissions ??
    {};

  return {
    canBulkEdit: readBoolean(
      permissions.canBulkEdit ??
        permissions.canEditProducts ??
        permissions.bulkEdit,
      true,
    ),
    canExport: readBoolean(
      permissions.canExport ??
        permissions.canExportProducts ??
        permissions.exportProducts,
      true,
    ),
    canImport: readBoolean(
      permissions.canImport ??
        permissions.canImportProducts ??
        permissions.importProducts,
      true,
    ),
    canSync: readBoolean(
      permissions.canSync ??
        permissions.canSyncCatalog ??
        permissions.syncProducts,
      true,
    ),
    canManageBilling: readBoolean(
      permissions.canManageBilling ?? permissions.billing,
      true,
    ),
    canManageSnippets: readBoolean(
      permissions.canManageSnippets ?? permissions.snippetStudio,
      true,
    ),
  };
}

function normalizePlan(raw, { currentEditCount }) {
  const maxEdits = raw?.maxEdits;
  const hasLimit = maxEdits != null && Number(maxEdits) > 0;
  const usagePercent = hasLimit
    ? Math.min(100, Math.round((currentEditCount / Number(maxEdits)) * 100))
    : null;
  const isBlocked = hasLimit && currentEditCount >= Number(maxEdits);
  const isNearLimit = hasLimit && !isBlocked && usagePercent >= 80;
  const isAvailable =
    raw?.planStatus === "active" ||
    raw?.active === true ||
    raw?.isCreditAvailable === true ||
    !raw?.planStatus;

  const status = isBlocked
    ? "blocked"
    : isNearLimit
    ? "near_limit"
    : isAvailable
    ? "available"
    : "unavailable";

  return {
    status,
    usageLabel: hasLimit
      ? `Bulk edits: ${formatDashboardNumber(
          currentEditCount,
        )} / ${formatDashboardNumber(maxEdits)} this month`
      : `Bulk edits: ${formatDashboardNumber(currentEditCount)} this month`,
    currentEditCount,
    maxEdits,
    usagePercent,
    planName: raw?.planName,
  };
}

function normalizeJobItem(job, index, fallbackType) {
  return {
    id: job.id ?? job.jobId ?? `${fallbackType}-${index}`,
    type: job.type ?? fallbackType,
    label: job.label ?? job.title ?? fallbackType,
    status: job.status ?? job.state ?? "running",
    detail: job.detail ?? job.description ?? job.message ?? null,
    diagnosticId: job.diagnosticId ?? job.errorId ?? null,
  };
}

function normalizeJobs(raw) {
  const jobs = raw?.jobs ?? {};
  const active = Array.isArray(jobs.active)
    ? jobs.active.map((job, index) => normalizeJobItem(job, index, "job"))
    : [];
  const failed = Array.isArray(jobs.failed)
    ? jobs.failed.map((job, index) => normalizeJobItem(job, index, "failed"))
    : [];

  const syntheticActive = [
    readNumber(jobs.syncRunning, jobs.runningSyncs, raw?.syncJobsRunning) >
      0 && {
      id: "sync-running",
      type: "sync",
      label: "Sync running",
      status: "running",
    },
    readNumber(jobs.exportsQueued, jobs.queuedExports, raw?.exportJobsQueued) >
      0 && {
      id: "exports-queued",
      type: "export",
      label: `${formatDashboardNumber(
        readNumber(
          jobs.exportsQueued,
          jobs.queuedExports,
          raw?.exportJobsQueued,
        ),
      )} exports queued`,
      status: "queued",
    },
    readNumber(jobs.editsQueued, jobs.queuedEdits, raw?.editJobsQueued) > 0 && {
      id: "edits-queued",
      type: "edit",
      label: `${formatDashboardNumber(
        readNumber(jobs.editsQueued, jobs.queuedEdits, raw?.editJobsQueued),
      )} bulk edits queued`,
      status: "queued",
    },
    readNumber(jobs.importsQueued, jobs.queuedImports, raw?.importJobsQueued) >
      0 && {
      id: "imports-queued",
      type: "import",
      label: `${formatDashboardNumber(
        readNumber(
          jobs.importsQueued,
          jobs.queuedImports,
          raw?.importJobsQueued,
        ),
      )} imports queued`,
      status: "queued",
    },
  ].filter(Boolean);

  return {
    active: [...active, ...syntheticActive],
    failed,
  };
}

function normalizeActivity(raw) {
  if (!Array.isArray(raw?.recentActivities)) return [];

  return raw.recentActivities.map((activity, index) => ({
    id: activity.id ?? `${activity.type ?? "activity"}-${index}`,
    type: activity.type,
    title: activity.title,
    description: [activity.description, activity.timeAgo]
      .filter(Boolean)
      .join(" - "),
  }));
}

function normalizeUndo(raw) {
  const expiresAt = raw?.undoExpiresAt ?? raw?.lastUndoExpiresAt ?? null;
  return {
    available: raw?.undoAvailable === true || Boolean(expiresAt),
    expiresAt,
    label:
      raw?.undoLabel ??
      (expiresAt ? "Last edit can be undone for 2 days" : null),
  };
}

export function normalizeDashboardState(raw) {
  const productCount = readNumber(
    raw?.storeTotalProducts,
    raw?.productCount,
    raw?.totalProductCount,
  );
  const variantCount = readNumber(
    raw?.storeTotalVariants,
    raw?.variantCount,
    raw?.totalVariantCount,
  );
  const currentEditCount = readNumber(
    raw?.currentEditCount,
    raw?.totalBulkEditCount,
    raw?.totalbulkEditCount,
  );
  const exportsCount = readNumber(raw?.totalExportCount);
  const importsCount = readNumber(raw?.totalImportCount);
  const catalog = normalizeCatalog(raw, { productCount, variantCount });
  const plan = normalizePlan(raw, { currentEditCount });
  const activity = normalizeActivity(raw);
  const storeSize =
    productCount >= 10000 || variantCount >= 50000
      ? "large"
      : productCount > 0
      ? "small"
      : "empty";

  return {
    raw,
    catalog,
    permissions: normalizePermissions(raw),
    plan,
    jobs: normalizeJobs(raw),
    activity,
    undo: normalizeUndo(raw),
    metrics: {
      bulkEdits: currentEditCount,
      exports: exportsCount,
      imports: importsCount,
    },
    storeSize,
    isCreditAvailable: raw?.isCreditAvailable === true,
    hasNoOperationalActivity:
      currentEditCount === 0 && exportsCount === 0 && importsCount === 0,
  };
}

function guard({
  blocked,
  disabledReason,
  requiresPlan,
  requiresSyncedCatalog,
}) {
  return {
    disabled: Boolean(blocked),
    disabledReason: blocked ? disabledReason : null,
    requiresPlan,
    requiresSyncedCatalog,
  };
}

export function getDashboardActionGuards(state) {
  const catalogReason = state.catalog.disabledReason;
  const planReason =
    state.plan.status === "blocked"
      ? "Plan limit reached. Upgrade or wait for the next billing cycle."
      : state.plan.status === "unavailable"
      ? "A plan is required to use this action."
      : null;

  return {
    bulkEdit: guard({
      blocked:
        !state.catalog.canPreview ||
        !state.permissions.canBulkEdit ||
        Boolean(planReason),
      disabledReason:
        (!state.catalog.canPreview ? catalogReason : null) ||
        (!state.permissions.canBulkEdit
          ? "Your staff account does not have permission to edit products."
          : planReason),
      requiresPlan: true,
      requiresSyncedCatalog: true,
    }),
    exportProducts: guard({
      blocked: !state.permissions.canExport || Boolean(planReason),
      disabledReason: !state.permissions.canExport
        ? "Your staff account does not have permission to export products."
        : planReason,
      requiresPlan: true,
      requiresSyncedCatalog: false,
    }),
    importProducts: guard({
      blocked: !state.permissions.canImport || Boolean(planReason),
      disabledReason: !state.permissions.canImport
        ? "Your staff account does not have permission to import products."
        : planReason,
      requiresPlan: true,
      requiresSyncedCatalog: false,
    }),
    syncCatalog: guard({
      blocked: !state.permissions.canSync,
      disabledReason: !state.permissions.canSync
        ? "Your staff account does not have permission to sync products."
        : null,
      requiresPlan: false,
      requiresSyncedCatalog: false,
    }),
    snippets: guard({
      blocked: !state.permissions.canManageSnippets,
      disabledReason: !state.permissions.canManageSnippets
        ? "Your staff account does not have permission to manage snippets."
        : null,
      requiresPlan: false,
      requiresSyncedCatalog: false,
    }),
  };
}

export function normalizeStoreAccess(raw) {
  const state = normalizeDashboardState(raw);

  return {
    raw,
    productCount: state.catalog.productCount,
    variantCount: state.catalog.variantCount,
    bulkEdits: state.metrics.bulkEdits,
    exportsCount: state.metrics.exports,
    importsCount: state.metrics.imports,
    hasCatalogData:
      state.catalog.productCount > 0 || state.catalog.variantCount > 0,
    hasNoOperationalActivity: state.hasNoOperationalActivity,
    syncStatus: state.catalog.status,
    isSyncing: state.catalog.status === "initial_sync_running",
    editingDisabled: !state.catalog.canExecute,
    storeSize: state.storeSize,
    lastSyncedAt: state.catalog.lastSyncedAt,
    staleReason: state.catalog.disabledReason,
    isCreditAvailable: state.isCreditAvailable,
    currentEditCount: state.plan.currentEditCount,
    maxEdits: state.plan.maxEdits,
    planName: state.plan.planName,
    permissions: {
      canEditProducts: state.permissions.canBulkEdit,
      canExportProducts: state.permissions.canExport,
      canImportProducts: state.permissions.canImport,
      canSyncCatalog: state.permissions.canSync,
      canManageSnippets: state.permissions.canManageSnippets,
    },
    activeJobs: {
      syncRunning: state.jobs.active.filter((job) => job.type === "sync")
        .length,
      exportsQueued: state.jobs.active.filter((job) => job.type === "export")
        .length,
      editsQueued: state.jobs.active.filter((job) => job.type === "edit")
        .length,
      importsQueued: state.jobs.active.filter((job) => job.type === "import")
        .length,
    },
    recentActivities: state.activity,
  };
}
