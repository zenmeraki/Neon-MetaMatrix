import {
  BulkEditSource,
} from "../shared/bulkEdit/bulkEditIntent.schema.js";
import { normalizeLegacyBulkEditPayload } from "../shared/bulkEdit/bulkEditIntent.normalizer.js";
import { validateBulkEditIntent } from "../shared/bulkEdit/bulkEditIntent.validator.js";

function report(name, ok, details = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details ? ` :: ${details}` : ""}`);
}

const shop = "demo.myshopify.com";
const healthyContext = { requireHealthyMirror: true, mirrorHealthState: "HEALTHY" };

// 1) Manual bulk edit
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.MANUAL,
    body: {
      editedField: "title",
      editedType: "Set text to value",
      value: "Updated title",
      targetSnapshotId: "snap_1",
      idempotencyKey: "k_manual_1",
      confirmationToken: "ok",
    },
  });
  const v = validateBulkEditIntent(intent, healthyContext);
  report("manual bulk edit normalized/valid", v.valid, `source=${intent.source} mode=${intent.target.mode}`);
}

// 2) Inline edit source
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.INLINE,
    body: {
      editedField: "price",
      editedType: "Set to fixed value",
      value: "19.99",
      ids: ["gid://shopify/Product/1"],
      idempotencyKey: "k_inline_1",
      confirmationToken: "ok",
    },
  });
  report("inline source", intent.source === "INLINE", `source=${intent.source}`);
}

// 3) Scheduled edit target mode snapshot
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.SCHEDULED,
    body: {
      editedField: "status",
      editedType: "Set status",
      value: "DRAFT",
      targetSnapshotId: "snap_2",
      idempotencyKey: "k_sched_1",
      confirmationToken: "ok",
    },
  });
  report("scheduled target snapshot", intent.target.mode === "SNAPSHOT", `mode=${intent.target.mode}`);
}

// 4) Recurring rule run target mode runtime rule
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: null,
    source: BulkEditSource.RECURRING_RULE_RUN,
    body: {
      editedField: "title",
      editedType: "Search/Replace",
      searchKey: "A",
      replaceText: "B",
      runtimeRule: { ast: { op: "AND", nodes: [] } },
      idempotencyKey: "k_recur_1",
      confirmationToken: "ok",
    },
  });
  report("recurring mode runtime rule", intent.target.mode === "RUNTIME_RULE", `mode=${intent.target.mode}`);
}

// 5) Invalid field/editType combo
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.MANUAL,
    body: {
      editedField: "status",
      editedType: "Add text to end",
      value: "x",
      targetSnapshotId: "snap_3",
      idempotencyKey: "k_invalid_combo",
      confirmationToken: "ok",
    },
  });
  const v = validateBulkEditIntent(intent, healthyContext);
  const hasError = v.errors.some((e) => e.code === "EDIT_TYPE_NOT_ALLOWED");
  report("invalid field/editType rejected", !v.valid && hasError, JSON.stringify(v.errors));
}

// 6) Destructive edit without confirmation token
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.MANUAL,
    body: {
      editedField: "status",
      editedType: "Set status",
      value: "ACTIVE",
      targetSnapshotId: "snap_4",
      idempotencyKey: "k_no_confirm",
      confirmationToken: null,
    },
  });
  // Force no token after normalizer fallback to validate strict rule behavior.
  intent.safety.confirmationToken = null;
  const v = validateBulkEditIntent(intent, healthyContext);
  const hasError = v.errors.some((e) => e.code === "CONFIRMATION_REQUIRED");
  report("destructive op requires confirmation", !v.valid && hasError, JSON.stringify(v.errors));
}

// 7) Inventory edit without locationId
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.MANUAL,
    body: {
      editedField: "inventory",
      editedType: "Set to fixed value",
      value: "10",
      targetSnapshotId: "snap_5",
      idempotencyKey: "k_inventory_no_location",
      confirmationToken: "ok",
    },
  });
  const v = validateBulkEditIntent(intent, healthyContext);
  const hasError = v.errors.some((e) => e.code === "LOCATION_REQUIRED");
  report("inventory requires location", !v.valid && hasError, JSON.stringify(v.errors));
}

// 8) Missing idempotency key
{
  const intent = normalizeLegacyBulkEditPayload({
    shop,
    actorId: "u1",
    source: BulkEditSource.MANUAL,
    body: {
      editedField: "title",
      editedType: "Set text to value",
      value: "x",
      targetSnapshotId: "snap_6",
      confirmationToken: "ok",
      idempotencyKey: null,
      requestId: null,
      clientRequestId: null,
    },
  });
  // Force missing to validate strict rule behavior.
  intent.safety.idempotencyKey = null;
  const v = validateBulkEditIntent(intent, healthyContext);
  const hasError = v.errors.some((e) => e.code === "IDEMPOTENCY_KEY_REQUIRED");
  report("idempotency key required", !v.valid && hasError, JSON.stringify(v.errors));
}

