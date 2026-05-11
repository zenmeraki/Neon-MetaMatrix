import axios from "axios";
import readline from "node:readline";
import { prisma } from "../config/database.js";

const SHOP = process.env.SHOP || "demo-zen-store.myshopify.com";
const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2025-10";
const PRODUCT_UPDATE_CHUNK = Number(process.env.PRODUCT_UPDATE_CHUNK || 25);
const PRODUCT_UPDATE_RETRIES = Number(process.env.PRODUCT_UPDATE_RETRIES || 4);
const PRODUCT_UPDATE_RETRY_DELAY_MS = Number(
  process.env.PRODUCT_UPDATE_RETRY_DELAY_MS || 500,
);

const statusQuery = `query GetBulkOperation($id: ID!) {
  node(id: $id) {
    ... on BulkOperation {
      id
      status
      errorCode
      url
      completedAt
      createdAt
    }
  }
}`;

async function queryShopify(shop, accessToken, query, variables = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const response = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    },
  );

  if (response?.data?.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data;
}

async function waitForCompletion(shop, accessToken, bulkOperationId, maxPolls = 90) {
  for (let i = 0; i < maxPolls; i += 1) {
    const res = await queryShopify(shop, accessToken, statusQuery, { id: bulkOperationId });
    const op = res?.data?.node || null;
    const status = String(op?.status || "");
    console.log(`poll ${i + 1}: ${status}`);
    if (["COMPLETED", "FAILED", "CANCELED", "CANCELING"].includes(status)) {
      return op;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  throw new Error("Timed out waiting for Shopify bulk operation completion");
}

function isRetryablePrismaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("connection error") ||
    message.includes("deadlock") ||
    message.includes("p1017") ||
    message.includes("40p01")
  );
}

async function withRetry(fn, label) {
  for (let attempt = 1; attempt <= PRODUCT_UPDATE_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === PRODUCT_UPDATE_RETRIES || !isRetryablePrismaError(error)) {
        throw error;
      }
      console.warn(`${label} failed on attempt ${attempt}, retrying...`);
      await prisma.$disconnect().catch(() => {});
      await new Promise((r) =>
        setTimeout(r, PRODUCT_UPDATE_RETRY_DELAY_MS * attempt),
      );
    }
  }
}

async function completeLatestCollectionSync() {
  const latest = await prisma.syncHistory.findFirst({
    where: {
      shop: SHOP,
      operationType: "Collection",
      status: "processing",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latest?.bulkOperationId || !latest?.syncBatchId) {
    throw new Error("No in-flight collection sync history found");
  }

  const offlineSession = await prisma.shopifySession.findFirst({
    where: { shop: SHOP, isOnline: false },
    orderBy: { id: "asc" },
    select: { accessToken: true },
  });

  if (!offlineSession?.accessToken) {
    throw new Error("Offline Shopify access token not found in shopify_sessions");
  }

  const op = await waitForCompletion(SHOP, offlineSession.accessToken, latest.bulkOperationId);

  if (op?.status !== "COMPLETED" || !op?.url) {
    await prisma.syncHistory.update({
      where: { id: latest.id },
      data: {
        status: "failed",
        stage: "FAILED",
        errorMessage: `Bulk status=${op?.status || "unknown"} errorCode=${op?.errorCode || "none"}`,
      },
    });
    throw new Error(`Collection bulk failed: ${op?.status || "unknown"}`);
  }

  const streamRes = await axios.get(op.url, {
    responseType: "stream",
    headers: { Accept: "application/json" },
  });

  const collections = [];
  const memberships = [];
  const rl = readline.createInterface({
    input: streamRes.data,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line?.trim()) continue;
    const json = JSON.parse(line);

    if (!json.__parentId && json.__typename === "Collection") {
      collections.push({
        shopifyId: json.id,
        title: json.title?.trim() || null,
        handle: json.handle?.trim() || null,
        collectionType: json?.ruleSet ? "SMART" : "MANUAL",
      });
    }

    if (json.__parentId && json.__typename === "Product") {
      memberships.push({
        collectionId: json.__parentId,
        productId: json.id,
      });
    }
  }

  const dedupCollections = [];
  const seenCollection = new Set();
  for (const c of collections) {
    if (!c.shopifyId || !c.title) continue;
    if (seenCollection.has(c.shopifyId)) continue;
    seenCollection.add(c.shopifyId);
    dedupCollections.push(c);
  }

  const dedupMemberships = [];
  const seenMembership = new Set();
  for (const m of memberships) {
    if (!m.collectionId || !m.productId) continue;
    const key = `${m.productId}:${m.collectionId}`;
    if (seenMembership.has(key)) continue;
    seenMembership.add(key);
    dedupMemberships.push(m);
  }

  await prisma.productCollectionMembership.deleteMany({
    where: { shop: SHOP, mirrorBatchId: latest.syncBatchId },
  });
  await prisma.collection.deleteMany({
    where: { shop: SHOP, mirrorBatchId: latest.syncBatchId },
  });

  if (dedupCollections.length) {
    await prisma.collection.createMany({
      data: dedupCollections.map((c) => ({
        shop: SHOP,
        shopifyId: c.shopifyId,
        mirrorBatchId: latest.syncBatchId,
        title: c.title,
        handle: c.handle,
        collectionType: c.collectionType,
      })),
      skipDuplicates: true,
    });
  }

  if (dedupMemberships.length) {
    await prisma.productCollectionMembership.createMany({
      data: dedupMemberships.map((m) => ({
        shop: SHOP,
        productId: m.productId,
        collectionId: m.collectionId,
        mirrorBatchId: latest.syncBatchId,
      })),
      skipDuplicates: true,
    });
  }

  const store = await prisma.store.findUnique({
    where: { shopUrl: SHOP },
    select: { activeMirrorBatchId: true },
  });
  const productBatchId = store?.activeMirrorBatchId;
  if (!productBatchId) {
    throw new Error("Store has no activeMirrorBatchId");
  }

  const loadedCollections = await prisma.collection.findMany({
    where: { shop: SHOP, mirrorBatchId: latest.syncBatchId },
    select: { shopifyId: true, title: true, handle: true, collectionType: true },
  });
  const collectionById = new Map(
    loadedCollections
      .filter((c) => c.shopifyId)
      .map((c) => [c.shopifyId, c]),
  );

  const loadedMemberships = await prisma.productCollectionMembership.findMany({
    where: { shop: SHOP, mirrorBatchId: latest.syncBatchId },
    select: { productId: true, collectionId: true },
  });

  const collectionsByProduct = new Map();
  for (const m of loadedMemberships) {
    const c = collectionById.get(m.collectionId);
    if (!c?.title) continue;
    const arr = collectionsByProduct.get(m.productId) || [];
    arr.push({
      id: m.collectionId,
      title: c.title,
      handle: c.handle || null,
      type: c.collectionType || null,
    });
    collectionsByProduct.set(m.productId, arr);
  }

  await withRetry(
    () =>
      prisma.product.updateMany({
        where: { shop: SHOP, mirrorBatchId: productBatchId },
        data: { collectionsJson: [] },
      }),
    "clear collectionsJson",
  );

  const entries = Array.from(collectionsByProduct.entries());
  for (let i = 0; i < entries.length; i += PRODUCT_UPDATE_CHUNK) {
    const chunk = entries.slice(i, i + PRODUCT_UPDATE_CHUNK);
    for (const [productId, collectionsJson] of chunk) {
      await withRetry(
        () =>
          prisma.product.updateMany({
            where: { shop: SHOP, mirrorBatchId: productBatchId, id: productId },
            data: { collectionsJson },
          }),
        `update product ${productId}`,
      );
    }
  }

  await prisma.store.update({
    where: { shopUrl: SHOP },
    data: {
      isCollectionSyncing: false,
      lastCollectionSyncAt: new Date(),
      activeCollectionBatchId: latest.syncBatchId,
      lastCollectionReconcileAt: new Date(),
      lastReconcileAt: new Date(),
      mirrorHealthState: "HEALTHY",
      staleReason: null,
      repairRequired: false,
    },
  });

  await prisma.storeOperationalState.upsert({
    where: { shop: SHOP },
    update: {
      activeCollectionBatchId: latest.syncBatchId,
      lastSyncAt: new Date(),
    },
    create: {
      shop: SHOP,
      activeCollectionBatchId: latest.syncBatchId,
      catalogConsistencyStatus: "NOT_READY",
      lastSyncAt: new Date(),
    },
  });

  const createdAt = op.createdAt ? new Date(op.createdAt) : new Date();
  const completedAt = op.completedAt ? new Date(op.completedAt) : new Date();
  await prisma.syncHistory.update({
    where: { id: latest.id },
    data: {
      status: "completed",
      stage: "COMPLETED",
      responseUrl: op.url,
      duration: Math.max(completedAt.getTime() - createdAt.getTime(), 0),
      recordCount: loadedCollections.length,
    },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        shop: SHOP,
        syncHistoryId: latest.id,
        syncBatchId: latest.syncBatchId,
        bulkOperationId: latest.bulkOperationId,
        collections: loadedCollections.length,
        memberships: loadedMemberships.length,
        productsReconciled: entries.length,
      },
      null,
      2,
    ),
  );
}

completeLatestCollectionSync()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
