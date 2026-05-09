import assert from "node:assert/strict";
import test from "node:test";

function buildExecutionKey(scheduledExportId, scheduledFor) {
  return `${scheduledExportId}:${new Date(scheduledFor).toISOString()}`;
}

function createInMemorySchedulerFixture() {
  const scheduledFor = new Date("2026-05-05T10:00:00.000Z");
  const exportRow = {
    id: "se_1",
    shop: "shop-a.myshopify.com",
    status: "ACTIVE",
    isDeleted: false,
    nextRunAt: scheduledFor,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    lockedBy: null,
    lockedAt: null,
  };

  const runsByExecutionKey = new Map();
  let runSeq = 1;

  return {
    exportRow,
    runsByExecutionKey,
    async claimDueScheduledExports({ now, lockedBy }) {
      if (
        exportRow.isDeleted ||
        exportRow.status !== "ACTIVE" ||
        !exportRow.nextRunAt ||
        exportRow.nextRunAt > now
      ) {
        return [];
      }

      if (exportRow.lockedBy && exportRow.lockedBy !== lockedBy) {
        return [];
      }

      if (!exportRow.lockedBy) {
        exportRow.lockedBy = lockedBy;
        exportRow.lockedAt = now;
      }

      return [{ id: exportRow.id, shop: exportRow.shop }];
    },
    async reserveRunForClaimedRow({ scheduledExportId, shop, now }) {
      const executionKey = buildExecutionKey(scheduledExportId, exportRow.nextRunAt);
      const existing = runsByExecutionKey.get(executionKey);
      if (existing) {
        return existing;
      }

      const run = {
        id: `ser_${runSeq++}`,
        scheduledExportId,
        shop,
        scheduledFor: exportRow.nextRunAt,
        executionKey,
        status: "PENDING",
        createdAt: now,
      };
      runsByExecutionKey.set(executionKey, run);
      return run;
    },
    async advanceSchedule(now) {
      exportRow.nextRunAt = new Date(now.getTime() + 60_000);
      exportRow.lockedBy = null;
      exportRow.lockedAt = null;
    },
  };
}

async function schedulerTick(fixture, { now, lockOwner }) {
  const claimed = await fixture.claimDueScheduledExports({
    now,
    limit: 100,
    lockedBy: lockOwner,
  });

  for (const row of claimed) {
    await fixture.reserveRunForClaimedRow({
      scheduledExportId: row.id,
      shop: row.shop,
      now,
    });
    await fixture.advanceSchedule(now);
  }
}

test("concurrent scheduler ticks create only one run per scheduledExportId + scheduledFor", async () => {
  const fixture = createInMemorySchedulerFixture();
  const now = new Date("2026-05-05T10:00:00.000Z");

  await Promise.all([
    schedulerTick(fixture, {
      now,
      lockOwner: "tick-A",
    }),
    schedulerTick(fixture, {
      now,
      lockOwner: "tick-B",
    }),
  ]);

  assert.equal(
    fixture.runsByExecutionKey.size,
    1,
    "expected exactly one scheduled export run to be created",
  );

  const [run] = fixture.runsByExecutionKey.values();
  assert.equal(run.scheduledExportId, "se_1");
  assert.equal(run.shop, "shop-a.myshopify.com");
  assert.equal(run.executionKey, "se_1:2026-05-05T10:00:00.000Z");
});
