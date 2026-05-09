# Production Hardening Gate (Freeze New Feature Work)

Do not ship new filter/export features until all scenarios pass in staging:

1. `duplicate_webhook_delivery`
- Trigger the same Shopify bulk webhook payload twice.
- Expected: one finalization path succeeds; second path is idempotent and no-op.

2. `worker_crash_after_shopify_accept`
- Crash worker after dispatch accepted, before terminal write.
- Expected: recovery sweeper and retry reconcile exactly once; no duplicate submit.

3. `worker_crash_mid_freeze`
- Crash worker after target freeze starts but before execute scheduling.
- Expected: no partial snapshot corruption; retry resumes deterministically.

4. `out_of_order_webhook`
- Deliver completion webhook before accepted/running internal state write.
- Expected: handler is state-aware and retry-safe; eventual single finalization only.

5. `redis_restart`
- Restart Redis while workers are active.
- Expected: no duplicate edit submission, no stuck executions, no orphaned operation state.

6. `neon_failover`
- Trigger DB failover / connection churn during active operations.
- Expected: retries are bounded; state machine remains valid; operations recover without duplication.

7. `partial_jsonl_corruption`
- Corrupt a subset of staged JSONL result lines.
- Expected: ingestion fails safely with diagnostics; no partial apply marked complete.

8. `slow_shopify_bulk_op`
- Simulate long-running Shopify bulk operation.
- Expected: no premature terminal state; heartbeat and sweeper avoid stuck state.

9. `rate_limit_storms`
- Simulate repeated 429/5xx burst.
- Expected: adaptive backoff; no retry storm; eventual fail/recover without duplicate submissions.

Pass criteria:
- No cross-shop mutations.
- No duplicate Shopify submission for same correlation tuple.
- No terminal status drift between ledger and projection.
- All CAS conflicts fail job immediately and are observable.

Run strict gate:

```bash
node web/scripts/runFinalChaosSuite.js
```

Manual scenario evidence file:

```bash
web/docs/chaos-manual-evidence.json
```

The suite marks all unverified manual scenarios as `FAIL` by default.
