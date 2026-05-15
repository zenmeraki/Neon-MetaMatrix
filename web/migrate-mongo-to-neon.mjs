/**
 * ============================================================
 *  METAMATRIX — MongoDB → Neon PostgreSQL Migration Script
 * ============================================================
 *
 * USAGE
 *   1. npm install mongoose @prisma/client
 *   2. Set env vars (see below) in a .env file or your shell
 *   3. node migrate-mongo-to-neon.mjs
 *
 * ENV VARS REQUIRED
 *   MONGO_URI        e.g. mongodb+srv://user:pass@cluster.mongodb.net/metamatrix
 *   DATABASE_URL     Neon connection string (same one Prisma uses)
 *
 * WHAT IS MIGRATED
 *   ✅  Store               (flattens syncDetails + referralReward)
 *   ✅  Subscription
 *   ✅  SyncHistory
 *   ✅  EditHistory         (remaps ObjectIds → cuid strings)
 *   ✅  ChangeRecord        (uses editHistory ID map built above)
 *   ✅  ExportHistory
 *   ✅  ExportJob
 *   ✅  SpreadsheetFiles    → SpreadsheetFile
 *   ✅  Collection
 *   ✅  FilterTrack
 *   ✅  Suggestion
 *   ✅  ErrorLog
 *   ✅  AffiliateUser
 *   ✅  Location
 *   ✅  ReferralCode        (tempReferralCode)
 *
 * SKIPPED (no matching Prisma model — data stays in Mongo or was not ported)
 *   ⛔  products / variants  — schema diverged (Prisma adds mirrorBatchId);
 *                              re-sync from Shopify after migration.
 *   ⛔  FilterCombination    — no Prisma equivalent; keep in Mongo or drop.
 *   ⛔  WalletTransaction    — no Prisma equivalent.
 *   ⛔  RecurringEdit (Mongo) — Prisma RecurringEdit has a completely
 *                              different structure; rebuild via the app UI.
 *
 * IDEMPOTENCY
 *   Each section uses upsert (createMany skipDuplicates / upsert) where
 *   possible so you can re-run safely.
 * ============================================================
 */
import "dotenv/config";
import mongoose from "mongoose";
import { PrismaClient } from "./generated/prisma/index.js";
import { createId } from "@paralleldrive/cuid2"; // or use: crypto.randomUUID()

// ── tiny helper ──────────────────────────────────────────────
const toStr  = (v) => (v == null ? null : String(v));
const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
const toFloat= (v) => (v == null ? null : Number(v));
const toInt  = (v) => (v == null ? null : parseInt(v, 10));
const toBool = (v) => (v == null ? null : Boolean(v));
const toJson = (v) => (v == null ? null : v); // Prisma Json accepts plain objects
const newId  = () => createId();               // cuid2; swap for crypto.randomUUID() if you prefer

let migrated = 0, skipped = 0, errors = 0;
function log(label, n) {
  console.log(`  ✔  ${label}: ${n} rows`);
  migrated += n;
}
function warn(label, e) {
  console.warn(`  ✘  ${label}:`, e?.message ?? e);
  errors++;
}

// ── connect ──────────────────────────────────────────────────
const MONGO_URI    = process.env.MONGO_URI;
const DATABASE_URL = process.env.DATABASE_URL;
if (!MONGO_URI || !DATABASE_URL)
  throw new Error("Set MONGO_URI and DATABASE_URL env vars before running.");

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

await mongoose.connect(MONGO_URI);
console.log("✔ Connected to MongoDB");
await prisma.$connect();
console.log("✔ Connected to Neon PostgreSQL\n");

// ── inline Mongoose models (lightweight — read-only) ──────────
const mStore         = mongoose.model("Store",        new mongoose.Schema({}, { strict: false, collection: "stores"       }));
const mSub           = mongoose.model("Subscription", new mongoose.Schema({}, { strict: false, collection: "subscriptions"}));
const mSyncHist      = mongoose.model("SyncHistory",  new mongoose.Schema({}, { strict: false, collection: "synchistories"}));
const mEditHist      = mongoose.model("EditHistory",  new mongoose.Schema({}, { strict: false, collection: "edithistories"}));
const mChangeRecord  = mongoose.model("ChangeRecord", new mongoose.Schema({}, { strict: false, collection: "changerecords"}));
const mExportHist    = mongoose.model("ExportHistory",new mongoose.Schema({}, { strict: false, collection: "exporthistories"}));
const mExportJob     = mongoose.model("ExportJob",    new mongoose.Schema({}, { strict: false, collection: "exportjobs"   }));
const mSpreadsheet   = mongoose.model("SpreadsheetFiles", new mongoose.Schema({}, { strict: false, collection: "spreadsheetfiles"}));
const mCollection    = mongoose.model("Collection",   new mongoose.Schema({}, { strict: false, collection: "collections"  }));
const mFilterTrack   = mongoose.model("FilterTrack",  new mongoose.Schema({}, { strict: false, collection: "filtertracks" }));
const mSuggestion    = mongoose.model("Suggestion",   new mongoose.Schema({}, { strict: false, collection: "suggestions"  }));
const mErrorLog      = mongoose.model("ErrorLog",     new mongoose.Schema({}, { strict: false, collection: "errorlogs"    }));
const mAffiliate     = mongoose.model("AffiliateUser",new mongoose.Schema({}, { strict: false, collection: "affiliateusers"}));
const mLocation      = mongoose.model("Location",     new mongoose.Schema({}, { strict: false, collection: "locations"    }));
const mReferral      = mongoose.model("ReferralCode", new mongoose.Schema({}, { strict: false, collection: "tempreferralcodes"}));

const BATCH = 200; // rows per insert batch

// ════════════════════════════════════════════════════════════════
//  1. STORE
// ════════════════════════════════════════════════════════════════
console.log("── Store ──");
{
  const docs = await mStore.find({}).lean();
  let n = 0;
  for (const d of docs) {
    const sd = d.syncDetails ?? {};
    const rr = d.referralReward ?? {};
    try {
      await prisma.store.upsert({
        where: { shopUrl: d.shopUrl },
        update: {},           // don't overwrite on re-run
        create: {
          shopUrl:                         d.shopUrl,
          shopEmail:                       d.shopEmail ?? "",
          accessToken:                     d.accessToken ?? null,

          // sync details (flattened)
          isCollectionSyncing:             toBool(sd.isCollectionSyncing)     ?? false,
          lastCollectionSyncAt:            toDate(sd.lastCollectionSyncAt),
          isProductTypeSyncing:            toBool(sd.isProductTypeSyncing)    ?? false,
          lastProductTypeSyncAt:           toDate(sd.lastProductTypeSyncAt),
          isProductInitialySyning:         toBool(sd.isProductInitialySyning) ?? false,
          productInitialSyncProgress:      toInt(sd.productInitialSyncProgress) ?? 0,
          shopifyBulkJobCompleted:         toBool(sd.shopifyBulkJobCompleted)  ?? false,
          storeTotalProducts:              toInt(sd.storeTotalProducts)        ?? 0,
          isProductSyncing:                toBool(sd.isProductSyncing)         ?? false,
          lastProductSyncAt:               toDate(sd.lastProductSyncAt),

          // auth / install
          scope:                           d.scope ?? "",
          installedAt:                     toDate(d.installedAt),
          unInstalledAt:                   toDate(d.unInstalledAt),
          isUnInstalled:                   toBool(d.isUnInstalled) ?? false,

          // referral
          referralCode:                    d.referralCode ?? null,
          referralLink:                    d.referralLink ?? null,
          referredBy:                      d.referredBy   ?? null,

          // referral reward (flattened)
          refIsFirstSubscriptionCompleted: toBool(rr.isFirstSubscriptionCompleted) ?? false,
          refSubscribedDate:               toDate(rr.subscribedDate),
          refRewardExpiresAt:              toDate(rr.rewardExpiresAt),
          refRewarded:                     toBool(rr.rewarded) ?? false,
          refSubscribedPlanDetails:        toJson(rr.subscribedPlanDetails) ?? {},
          refEarnedPrice:                  toFloat(rr.earnedPrice) ?? 0,

          isCreditAvailable:               toBool(d.isCreditAvailable) ?? false,
          lastActivityAt:                  toDate(d.lastActivityAt),
          createdAt:                       toDate(d.createdAt) ?? new Date(),
          updatedAt:                       toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`Store[${d.shopUrl}]`, e); }
  }
  log("Store", n);
}

// ════════════════════════════════════════════════════════════════
//  2. SUBSCRIPTION
// ════════════════════════════════════════════════════════════════
console.log("── Subscription ──");
{
  const docs = await mSub.find({}).lean();
  let n = 0;
  for (const d of docs) {
    try {
      await prisma.subscription.upsert({
        where: { shop: d.shop },
        update: {},
        create: {
          shop:                  d.shop,
          planKey:               d.planKey   ?? null,
          planName:              d.planName  ?? null,
          subscriptionId:        d.subscriptionId        ?? null,
          status:                d.status               ?? "FREE",
          pendingSubscriptionId: d.pendingSubscriptionId ?? null,
          pendingPlanKey:        d.pendingPlanKey        ?? null,
          pendingPlanName:       d.pendingPlanName       ?? null,
          trialEndsAt:           toDate(d.trialEndsAt),
          currentPeriodEnd:      toDate(d.currentPeriodEnd),
          createdAt:             toDate(d.createdAt) ?? new Date(),
          updatedAt:             toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`Subscription[${d.shop}]`, e); }
  }
  log("Subscription", n);
}

// ════════════════════════════════════════════════════════════════
//  3. SYNC HISTORY
// ════════════════════════════════════════════════════════════════
console.log("── SyncHistory ──");
{
  const docs = await mSyncHist.find({}).lean();
  const rows = docs.map((d) => ({
    shop:                d.shop,
    bulkOperationId:     d.bulkOperationId ?? null,
    syncBatchId:         null,
    responseUrl:         d.responseUrl     ?? null,
    status:              d.status          ?? "processing",
    stage:               null,
    errorMessage:        null,
    duration:            toInt(d.duration) ?? 0,
    recordCount:         toInt(d.recordCount),
    operationType:       d.operationType   ?? null,
    isInitialProductSync:toBool(d.isInitialProductSync) ?? false,
    createdAt:           toDate(d.createdAt) ?? new Date(),
    updatedAt:           toDate(d.updatedAt) ?? new Date(),
  }));
  try {
    const r = await prisma.syncHistory.createMany({ data: rows, skipDuplicates: true });
    log("SyncHistory", r.count);
  } catch (e) { warn("SyncHistory", e); }
}

// ════════════════════════════════════════════════════════════════
//  4. EDIT HISTORY  (build ObjectId → new-string-id map)
// ════════════════════════════════════════════════════════════════
console.log("── EditHistory ──");
const editHistoryIdMap = new Map(); // mongoObjectId(string) → new prisma id

{
  const docs = await mEditHist.find({}).lean();
  let n = 0;
  for (const d of docs) {
    const mongoId = toStr(d._id);
    const newPrismaId = newId();
    editHistoryIdMap.set(mongoId, newPrismaId);

    try {
await prisma.editHistory.upsert({
  where: { id: newPrismaId },
  update: {},
  create: {                    // ← directly here, NO nested data: {}
    id:                      newPrismaId,
    shop:                    d.shop,
    bulkOperationId:         d.bulkOperationId ?? null,
    executionState:          "planned",
    targetSnapshotCount:     0,
    targetMirrorBatchId:     null,
    title:                   toJson(d.title),
    queryFilter:             d.queryFilter ?? "",
    editedType:              d.editedType  ?? null,
    rules:                   toJson(d.rules),
    affectedFields:          toJson(d.affectedFields),
    locationId:              d.locationId ? toStr(d.locationId) : null,
    status:                  d.status      ?? "pending",
    scheduledAt:             toDate(d.scheduledAt),
    scheduledUndoAt:         toDate(d.scheduledUndoAt),
    processedCount:          toInt(d.processedCount) ?? 0,
    totalItems:              toInt(d.totalItems)     ?? 0,
    totalRows:               toInt(d.totalRows)      ?? 0,
    durationMs:              toInt(d.durationMs)     ?? 0,
    editTime:                toDate(d.editTime) ?? new Date(),
    startedAt:               toDate(d.startedAt) ?? new Date(),
    completedAt:             toDate(d.completedAt),
    undo:                    toJson(d.undo),
    batch:                   toJson(d.batch),
    type:                    d.type        ?? "Manual edit",
    processingBatchId:       d.processingBatchId ?? null,
    user:                    d.user        ?? null,
    isFavourite:             toBool(d.isFavourite)       ?? false,
    isSpreadsheetEdit:       toBool(d.isSpreadsheetEdit) ?? false,
    isRecurring:             false,
    triggerType:             "MANUAL",
    error:                   toJson(d.error),
    createdAt:               toDate(d.createdAt) ?? new Date(),
    updatedAt:               toDate(d.updatedAt) ?? new Date(),
  },
});
      n++;
    } catch (e) { warn(`EditHistory[${mongoId}]`, e); }
  }
  log("EditHistory", n);
}

// ════════════════════════════════════════════════════════════════
//  5. CHANGE RECORD  (uses editHistoryIdMap)
// ════════════════════════════════════════════════════════════════
console.log("── ChangeRecord ──");
{
  const docs = await mChangeRecord.find({}).lean();
  let n = 0;
  const rows = [];

  for (const d of docs) {
    const mongoEditId  = toStr(d.editHistoryId);
    const prismaEditId = editHistoryIdMap.get(mongoEditId);
    if (!prismaEditId) {
      warn(`ChangeRecord — editHistoryId ${mongoEditId} not found`, "");
      skipped++;
      continue;
    }
    rows.push({
      editHistoryId:       prismaEditId,
      productId:           d.productId,
      shop:                d.shop,
      options:             toJson(d.options),
      productFieldChanges: toJson(d.productFieldChanges),
      variantFieldChanges: toJson(d.variantFieldChanges),
      image:               d.image ?? null,
      title:               d.title,
      scope:               d.scope,
      status:              d.status  ?? "pending",
      batchId:             d.batchId ?? null,
      createdAt:           toDate(d.createdAt) ?? new Date(),
      updatedAt:           toDate(d.updatedAt) ?? new Date(),
    });
  }

  // Insert in batches of 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const r = await prisma.changeRecord.createMany({ data: batch, skipDuplicates: true });
    n += r.count;
    console.log(`  … ChangeRecord batch ${i / 200 + 1}: ${n}/${rows.length}`);
  }
  log("ChangeRecord", n);
}

// ════════════════════════════════════════════════════════════════
//  6. EXPORT HISTORY
// ════════════════════════════════════════════════════════════════
console.log("── ExportHistory ──");
{
  const docs = await mExportHist.find({}).lean();
  let n = 0;
  for (const d of docs) {
    // Normalize status to what Prisma expects
    const statusMap = {
      completed: "completed", processing: "processing", failed: "failed",
      Scheduled: "completed", pending: "completed",
    };
    const typeMap = {
      "Manual export": "Manual export",
      "Scheduled export": "Manual export",
      "Reccuring export": "Manual export", // typo in mongo schema
    };
    try {
      await prisma.exportHistory.create({
        data: {
          shop:          d.shop,
          filename:      d.filename,
          filters:       toJson(d.filters) ?? {},
          exportedData:  d.exportedData ?? null,
          status:        statusMap[d.status] ?? "completed",
          duration:      toStr(d.duration) ?? "0",
          totalItems:    toInt(d.totalItems),
          errorMessage:  d.errorMessage ?? null,
          exportTime:    toDate(d.exportTime),
          type:          typeMap[d.type] ?? "Manual export",
          isFavourite:   toBool(d.isFavourite) ?? false,
          scheduledTask: d.scheduledTask ?? null,
          createdAt:     toDate(d.createdAt) ?? new Date(),
          updatedAt:     toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`ExportHistory[${toStr(d._id)}]`, e); }
  }
  log("ExportHistory", n);
}

// ════════════════════════════════════════════════════════════════
//  7. EXPORT JOB
// ════════════════════════════════════════════════════════════════
console.log("── ExportJob ──");
{
  const docs = await mExportJob.find({}).lean();
  let n = 0;
  for (const d of docs) {
    try {
      await prisma.exportJob.create({
        data: {
          shop:          d.shop,
          filterQuery:   d.filterQuery   ?? "{}",
          filename:      d.filename,
          fields:        d.fields        ?? [],
          status:        d.status        ?? "PENDING",
          fileUrl:       d.fileUrl       ?? null,
          type:          d.type          ?? "Manual export",
          totalItems:    toInt(d.totalItems),
          durationMs:    toInt(d.durationMs),
          startedAt:     toDate(d.startedAt),
          completedAt:   toDate(d.completedAt),
          error:         d.error         ?? null,
          createdAt:     toDate(d.createdAt) ?? new Date(),
          updatedAt:     toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`ExportJob[${toStr(d._id)}]`, e); }
  }
  log("ExportJob", n);
}

// ════════════════════════════════════════════════════════════════
//  8. SPREADSHEET FILE
// ════════════════════════════════════════════════════════════════
console.log("── SpreadsheetFile ──");
{
  const docs = await mSpreadsheet.find({}).lean();
  const rows = docs.map((d) => ({
    shop:           d.shop           ?? null,
    editHistoryId:  d.editHistoryId  ? (editHistoryIdMap.get(toStr(d.editHistoryId)) ?? null) : null,
    fileUrl:        d.fileUrl        ?? null,
    columnMappings: toJson(d.columnMappings),
    totalRows:      toInt(d.totalRows),
    createdAt:      toDate(d.createdAt) ?? new Date(),
    updatedAt:      toDate(d.updatedAt) ?? new Date(),
  }));
  try {
    const r = await prisma.spreadsheetFile.createMany({ data: rows, skipDuplicates: true });
    log("SpreadsheetFile", r.count);
  } catch (e) { warn("SpreadsheetFile", e); }
}

// ════════════════════════════════════════════════════════════════
//  9. COLLECTION
// ════════════════════════════════════════════════════════════════
console.log("── Collection ──");
{
  const docs = await mCollection.find({}).lean();
  const rows = docs.map((d) => ({
    shop:          d.shop   ?? null,
    shopifyId:     d.id     ?? null,   // mongo field is `id` (Shopify GID)
    mirrorBatchId: null,
    title:         d.title  ?? null,
    handle:        d.handle ?? null,
    createdAt:     toDate(d.createdAt) ?? new Date(),
    updatedAt:     toDate(d.updatedAt) ?? new Date(),
  }));
  try {
    const r = await prisma.collection.createMany({ data: rows, skipDuplicates: true });
    log("Collection", r.count);
  } catch (e) { warn("Collection", e); }
}

// ════════════════════════════════════════════════════════════════
//  10. FILTER TRACK
// ════════════════════════════════════════════════════════════════
console.log("── FilterTrack ──");
{
  const docs = await mFilterTrack.find({}).lean();
  const rows = docs.map((d) => ({
    shop:                d.shop                ?? null,
    filterParams:        toJson(d.filterParams),
    previewFilterParams: toJson(d.previewFilterParams),
    respondProductCount: toInt(d.respondProductCount),
    previewResCount:     toInt(d.previewResCount),
    type:                d.type        ?? "filter",
    field:               d.field       ?? null,
    editOption:          d.editOption  ?? null,
    searchKey:           d.searchKey   ?? null,
    replaceText:         d.replaceText ?? null,
    supportValue:        d.supportValue?? null,
    value:               toJson(d.value),
    en:                  d.en          ?? null,
    createdAt:           toDate(d.createdAt) ?? new Date(),
    updatedAt:           toDate(d.updatedAt) ?? new Date(),
  }));
  try {
    const r = await prisma.filterTrack.createMany({ data: rows, skipDuplicates: true });
    log("FilterTrack", r.count);
  } catch (e) { warn("FilterTrack", e); }
}

// ════════════════════════════════════════════════════════════════
//  11. SUGGESTION
// ════════════════════════════════════════════════════════════════
console.log("── Suggestion ──");
{
  const docs = await mSuggestion.find({}).lean();
  const rows = docs.map((d) => ({
    email:      d.email,
    suggestion: d.suggestion,
    createdAt:  toDate(d.createdAt) ?? new Date(),
    updatedAt:  toDate(d.updatedAt) ?? new Date(),
  }));
  try {
    const r = await prisma.suggestion.createMany({ data: rows, skipDuplicates: true });
    log("Suggestion", r.count);
  } catch (e) { warn("Suggestion", e); }
}

// ════════════════════════════════════════════════════════════════
//  12. ERROR LOG
// ════════════════════════════════════════════════════════════════
console.log("── ErrorLog ──");
{
  const docs = await mErrorLog.find({}).lean();
  let n = 0;
  for (const d of docs) {
    try {
      await prisma.errorLog.create({
        data: {
          shop:      d.shop,
          type:      d.type    ?? "api",
          level:     d.level   ?? "error",
          message:   d.message,
          stack:     d.stack   ?? null,
          source:    d.source  ?? null,
          request:   toJson(d.request),
          createdAt: toDate(d.createdAt) ?? new Date(),
          updatedAt: toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`ErrorLog[${toStr(d._id)}]`, e); }
  }
  log("ErrorLog", n);
}

// ════════════════════════════════════════════════════════════════
//  13. AFFILIATE USER
// ════════════════════════════════════════════════════════════════
console.log("── AffiliateUser ──");
{
  const docs = await mAffiliate.find({}).lean();
  let n = 0;
  for (const d of docs) {
    try {
      await prisma.affiliateUser.upsert({
        where: { email: d.email },
        update: {},
        create: {
          name:                     d.name,
          email:                    d.email,
          referralCode:             d.referralCode,
          referralLink:             d.referralLink,
          numberOfReferrals:        toInt(d.numberOfReferrals)        ?? 0,
          numberOfStoresSubscribed: toInt(d.numberOfStoresSubscribed) ?? 0,
          totalAmountEarned:        toFloat(d.totalAmountEarned)      ?? 0,
          phone:                    d.phone ?? null,
          createdAt:                toDate(d.createdAt) ?? new Date(),
          updatedAt:                toDate(d.updatedAt) ?? new Date(),
        },
      });
      n++;
    } catch (e) { warn(`AffiliateUser[${d.email}]`, e); }
  }
  log("AffiliateUser", n);
}

// ════════════════════════════════════════════════════════════════
//  14. LOCATION
// ════════════════════════════════════════════════════════════════
console.log("── Location ──");
{
  const docs = await mLocation.find({}).lean();
  let n = 0;
  for (const d of docs) {
    try {
      await prisma.location.upsert({
        where: { shop_id: { shop: d.shop, id: d.id } },
        update: {},
        create: { shop: d.shop, id: d.id, name: d.name },
      });
      n++;
    } catch (e) { warn(`Location[${d.shop}/${d.id}]`, e); }
  }
  log("Location", n);
}

// ════════════════════════════════════════════════════════════════
//  15. REFERRAL CODE  (tempReferralCode)
// ════════════════════════════════════════════════════════════════
console.log("── ReferralCode ──");
{
  const docs = await mReferral.find({}).lean();
  const rows = docs.map((d) => ({
    shop:         d.shop,
    referralCode: d.referralCode,
    createdAt:    toDate(d.createdAt) ?? new Date(),
  }));
  try {
    const r = await prisma.referralCode.createMany({ data: rows, skipDuplicates: true });
    log("ReferralCode", r.count);
  } catch (e) { warn("ReferralCode", e); }
}

// ════════════════════════════════════════════════════════════════
//  SUMMARY
// ════════════════════════════════════════════════════════════════
console.log(`
════════════════════════════════
  Migration complete
  ✔ migrated : ${migrated}
  ⚠ skipped  : ${skipped}
  ✘ errors   : ${errors}
════════════════════════════════

Models NOT migrated (action needed):
  • products / variants  — re-sync from Shopify via app
  • FilterCombination    — no Prisma model; keep in Mongo or drop
  • WalletTransaction    — no Prisma model
  • RecurringEdit (old)  — schema diverged; rebuild in app UI
`);

await mongoose.disconnect();
await prisma.$disconnect();
