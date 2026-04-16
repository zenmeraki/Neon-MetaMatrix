import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePostgresConnectionString } from "./utils/postgresSslUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const privacySource = fs.readFileSync(path.join(__dirname, "privacy.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const webVitalsSource = fs.readFileSync(
  path.join(__dirname, "frontend/webVitals.js"),
  "utf8",
);
const frontendIndexHtml = fs.readFileSync(
  path.join(__dirname, "frontend/index.html"),
  "utf8",
);
const frontendAppCss = fs.readFileSync(
  path.join(__dirname, "frontend/app.css"),
  "utf8",
);
const frontendAppSource = fs.readFileSync(
  path.join(__dirname, "frontend/App.jsx"),
  "utf8",
);
const frontendStoreSource = fs.readFileSync(
  path.join(__dirname, "frontend/store/index.ts"),
  "utf8",
);
const productPageSource = fs.readFileSync(
  path.join(__dirname, "frontend/Domain/products/list/pages/Products.jsx"),
  "utf8",
);
const productStoreSource = fs.readFileSync(
  path.join(__dirname, "frontend/store/productStore.js"),
  "utf8",
);
const productsTableSource = fs.readFileSync(
  path.join(__dirname, "frontend/Domain/products/list/components/ProductsTable.jsx"),
  "utf8",
);
const frontendPackageSource = fs.readFileSync(
  path.join(__dirname, "frontend/package.json"),
  "utf8",
);
const appInstallationQueueSource = fs.readFileSync(
  path.join(__dirname, "Jobs/Queues/appInstallationJob.js"),
  "utf8",
);
const appInstallationWorkerSource = fs.readFileSync(
  path.join(__dirname, "Jobs/Workers/appInstallationWorker.js"),
  "utf8",
);
const recurringGroupedQueueSource = fs.readFileSync(
  path.join(__dirname, "Jobs/Queues/reccuringGroupedJobs.js"),
  "utf8",
);
const recurringWorkerSource = fs.readFileSync(
  path.join(__dirname, "Jobs/Workers/RecurringWorker.js"),
  "utf8",
);

test("registers the minimum operational Shopify webhook set", () => {
  const requiredTopics = [
    "APP_UNINSTALLED",
    "PRODUCTS_CREATE",
    "PRODUCTS_UPDATE",
    "PRODUCTS_DELETE",
    "COLLECTIONS_CREATE",
    "COLLECTIONS_UPDATE",
    "COLLECTIONS_DELETE",
    "INVENTORY_LEVELS_UPDATE",
    "INVENTORY_LEVELS_DISCONNECT",
    "SHOP_UPDATE",
    "BULK_OPERATIONS_FINISH",
  ];

  for (const topic of requiredTopics) {
    assert.match(privacySource, new RegExp(`\\b${topic}\\s*:`));
  }
});

test("shop-scoped operational webhooks queue reconciliation with idempotency metadata", () => {
  assert.match(privacySource, /async function queueShopSyncWebhook/);
  assert.match(privacySource, /reserveWebhookDelivery/);
  assert.match(privacySource, /upsertReconcileSignal/);
  assert.match(privacySource, /webhookId,\s*\n\s*entityId:/);
  assert.match(privacySource, /payload,\s*\n\s*}\);/);
});

test("Postgres SSL is configured without disabling certificate verification", () => {
  const insecurePatterns = [
    ["NODE_TLS", "REJECT_UNAUTHORIZED"].join("_"),
    ["rejectUnauthorized", " false"].join(":"),
  ];
  const checkedFiles = [
    "shopify.js",
    "scripts/phase0BatchAudit.js",
    "scripts/phase3BackfillCatalogBatch.js",
    "scripts/phase4ValidationGates.js",
    "scripts/phase4SurfaceParity.js",
  ];

  for (const relativePath of checkedFiles) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");

    for (const pattern of insecurePatterns) {
      assert.equal(
        source.includes(pattern),
        false,
        `${relativePath} must not contain ${pattern}`,
      );
    }
  }

  assert.equal(
    normalizePostgresConnectionString(
      "postgres://user:pass@ep-test-pooler.us-east-1.aws.neon.tech/db",
    ),
    "postgres://user:pass@ep-test-pooler.us-east-1.aws.neon.tech/db?sslmode=require",
  );
  assert.equal(
    normalizePostgresConnectionString(
      "postgres://user:pass@host/db?sslmode=verify-full",
    ),
    "postgres://user:pass@host/db?sslmode=verify-full",
  );
});

test("webhook routes use raw body before global JSON parsing", () => {
  for (const [name, source] of [
    ["index.js", indexSource],
    ["app.js", appSource],
  ]) {
    const webhookRouteIndex = source.indexOf("shopify.config.webhooks.path");
    const rawParserIndex = source.indexOf("express.raw", webhookRouteIndex);
    const processWebhooksIndex = source.indexOf("shopify.processWebhooks", rawParserIndex);
    const jsonParserIndex = source.indexOf("express.json");

    assert.notEqual(webhookRouteIndex, -1, `${name} must register webhooks`);
    assert.notEqual(rawParserIndex, -1, `${name} must use express.raw`);
    assert.notEqual(processWebhooksIndex, -1, `${name} must process webhooks after raw parser`);
    assert.ok(
      jsonParserIndex > processWebhooksIndex,
      `${name} must mount express.json after the webhook route`,
    );
  }
});

test("API process does not auto-import worker modules", () => {
  assert.equal(indexSource.includes("./Jobs/Workers/"), false);
  assert.equal(indexSource.includes("./workers/recurringEdit"), false);
  assert.match(
    fs.readFileSync(path.join(__dirname, "worker.js"), "utf8"),
    /Worker process started/,
  );
});

test("network surfaces do not use wildcard CORS origins", () => {
  for (const [name, source] of [
    ["index.js", indexSource],
    ["app.js", appSource],
    ["socket.js", fs.readFileSync(path.join(__dirname, "socket.js"), "utf8")],
  ]) {
    assert.equal(source.includes('origin: "*"'), false, `${name} has wildcard origin`);
    assert.equal(source.includes("cors()"), false, `${name} has default-open CORS`);
  }
});

test("frontend Web Vitals are collected and routed to metrics", () => {
  for (const metric of ["onCLS", "onFCP", "onINP", "onLCP", "onTTFB"]) {
    assert.match(webVitalsSource, new RegExp(`\\b${metric}\\b`));
  }

  assert.match(webVitalsSource, /\/api\/performance\/web-vitals/);
  assert.match(indexSource, /\/api\/performance/);
  assert.match(
    fs.readFileSync(path.join(__dirname, "utils/metricsUtils.js"), "utf8"),
    /frontend_web_vital_value/,
  );
});

test("frontend ships immediate FCP shell and defers third-party scripts", () => {
  assert.match(frontendIndexHtml, /class="app-shell"/);
  assert.match(frontendIndexHtml, /app-bridge\.js" defer/);
  assert.equal(frontendIndexHtml.includes("embed.tawk.to"), false);
  assert.match(
    fs.readFileSync(path.join(__dirname, "frontend/utils/thirdPartyScripts.js"), "utf8"),
    /requestIdleCallback/,
  );
});

test("frontend reserves stable layout slots to reduce CLS", () => {
  for (const selector of [
    "scrollbar-gutter: stable",
    ".route-stability-frame",
    ".page-loader-panel",
    ".products-table-frame",
    ".dashboard-promo-slot",
    ".demo-video-shell",
    ".embedded-widget-frame",
  ]) {
    assert.match(frontendAppCss, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(frontendIndexHtml, /scrollbar-gutter: stable/);
});

test("high-churn frontend state uses Zustand selectors instead of Redux", () => {
  assert.match(productStoreSource, /from "zustand"/);
  assert.match(productPageSource, /useProductStore\(selectProducts\)/);
  assert.match(productPageSource, /useProductStore\(selectSearch\)/);
  assert.equal(productPageSource.includes("useSelector"), false);
  assert.equal(productPageSource.includes("useDispatch"), false);
  assert.equal(frontendStoreSource.includes("productReducer"), false);
  assert.match(frontendAppSource, /useAppUiStore\(selectIsSyncing\)/);
});

test("product list uses Polaris IndexTable pagination without virtualization", () => {
  assert.match(productsTableSource, /\bIndexTable\b/);
  assert.match(productsTableSource, /\bPagination\b/);
  assert.equal(productsTableSource.includes("DataTable"), false);
  assert.equal(frontendPackageSource.includes("react-window"), false);
  assert.equal(frontendPackageSource.includes("react-virtualized-auto-sizer"), false);
});

test("frontend API endpoints are mounted by both server entrypoints", () => {
  const routeExpectations = [
    ["/api/products", "productRoutes"],
    ["/api/category", "categorytRoutes"],
    ["/api/collection", "collectionRoutes"],
    ["/api/history", "HistoryRoutes"],
    ["/api/location", "LocationRoutes"],
    ["/api/sync", "SyncRoutes"],
    ["/api/performance", "performanceRoutes"],
    ["/api", "compatRoutes"],
  ];

  for (const [mountPath, routeName] of routeExpectations) {
    for (const [name, source] of [
      ["index.js", indexSource],
      ["app.js", appSource],
    ]) {
      assert.match(
        source,
        new RegExp(`app\\.use\\("${mountPath.replace(/\//g, "\\/")}",\\s*userSessionAuth,\\s*${routeName}\\)`),
        `${name} must mount ${mountPath} with ${routeName}`,
      );
    }
  }
});

test("BullMQ queues used during app boot have deterministic fallback names", () => {
  assert.match(appInstallationQueueSource, /process\.env\.APP_INSTALLATION_QUEUE \|\| "app-installation"/);
  assert.match(appInstallationWorkerSource, /process\.env\.APP_INSTALLATION_QUEUE \|\| "app-installation"/);
  assert.match(recurringGroupedQueueSource, /process\.env\.RECURRING_QUEUE \|\| "recurring-edit-grouped"/);
  assert.match(recurringWorkerSource, /process\.env\.RECURRING_QUEUE \|\| "recurring-edit-grouped"/);
});
