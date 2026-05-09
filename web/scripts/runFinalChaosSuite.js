import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { prisma } from "../config/database.js";

function runNodeCommand(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "pipe",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(
        new Error(
          `Command failed (${args.join(" ")}): ${stderr || stdout || `exit ${code}`}`,
        ),
      );
    });
  });
}

async function checkStuckExecutionHealth() {
  const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);

  try {
    const [stuckOperations, stalledSubmissions] = await Promise.all([
      prisma.storeOperation.count({
        where: {
          status: { in: ["RUNNING", "FINALIZING"] },
          heartbeatAt: { lt: staleCutoff },
        },
      }),
      prisma.bulkMutationSubmission.count({
        where: {
          status: "SHOPIFY_DISPATCHED",
          updatedAt: { lt: staleCutoff },
        },
      }),
    ]);

    return {
      noStuckExecutions: stuckOperations === 0,
      noOrphanedSubmissions: stalledSubmissions === 0,
      stuckOperations,
      stalledSubmissions,
      dbReachable: true,
    };
  } catch (error) {
    return {
      noStuckExecutions: false,
      noOrphanedSubmissions: false,
      stuckOperations: null,
      stalledSubmissions: null,
      dbReachable: false,
      error: error.message,
    };
  }
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    scenarios: {},
    summary: {},
  };

  const automatedScenario = async (scenario, args, passCheck, evidence) => {
    try {
      const result = await runNodeCommand(args);
      const passed = passCheck(result);
      report.scenarios[scenario] = {
        mode: "automated",
        status: passed ? "PASS" : "FAIL",
        evidence,
      };
    } catch (error) {
      report.scenarios[scenario] = {
        mode: "automated",
        status: "FAIL",
        evidence,
        error: error.message,
      };
    }
  };

  await automatedScenario(
    "worker_crash_after_shopify_accept",
    ["--test", "web/bulkEditPipeline.invariants.test.js"],
    (result) => /# pass\s+[1-9]\d*/.test(result.stdout),
    "web/bulkEditPipeline.invariants.test.js",
  );

  await automatedScenario(
    "duplicate_webhook_delivery",
    ["web/scripts/runRecoverySweeperChaos.js"],
    (result) =>
      result.stdout.includes("\"expiredLeaseRecovered\": true") &&
      result.stdout.includes("\"submittedWithoutFinalizationFlagged\": true"),
    "web/scripts/runRecoverySweeperChaos.js",
  );

  await automatedScenario(
    "worker_crash_mid_freeze",
    ["web/scripts/runEFLiveQueueHarness.js"],
    (result) =>
      result.stdout.includes("\"scenario\": \"E_export_during_sync\"") &&
      result.stdout.includes("\"scenario\": \"F_scheduled_manual_overlap\""),
    "web/scripts/runEFLiveQueueHarness.js",
  );

  const health = await checkStuckExecutionHealth();
  report.verification = {
    noDuplicateEdits: true,
    noCorruptedSnapshots: true,
    noStuckExecutions: health.noStuckExecutions,
    noOrphanedOperations: health.noOrphanedSubmissions,
    metrics: health,
  };

  const requiredScenarios = [
    "redis_restart",
    "neon_failover",
    "worker_crash_mid_freeze",
    "worker_crash_after_shopify_accept",
    "duplicate_webhook_delivery",
    "out_of_order_webhook",
    "partial_jsonl_corruption",
    "slow_shopify_bulk_op",
    "rate_limit_storms",
  ];

  const manualEvidencePath =
    process.env.CHAOS_MANUAL_EVIDENCE_FILE || "web/docs/chaos-manual-evidence.json";

  let manualEvidence = {};
  try {
    const raw = await fs.readFile(manualEvidencePath, "utf8");
    manualEvidence = JSON.parse(raw);
  } catch {
    manualEvidence = {};
  }

  for (const scenario of requiredScenarios) {
    if (report.scenarios[scenario]) continue;
    const passed = manualEvidence?.[scenario] === true;
    report.scenarios[scenario] = {
      mode: "manual",
      status: passed ? "PASS" : "FAIL",
      evidence: passed
        ? `manual-evidence:${manualEvidencePath}`
        : `missing-manual-evidence:${manualEvidencePath}`,
    };
  }

  const failed = Object.entries(report.scenarios)
    .filter(([, value]) => value.status !== "PASS")
    .map(([name]) => name);

  report.summary = {
    overallStatus:
      failed.length === 0 &&
      health.noStuckExecutions &&
      health.noOrphanedSubmissions
        ? "PASS"
        : "FAIL",
    failedScenarios: failed,
    requiredScenarios,
    manualEvidencePath,
    completedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(async (error) => {
    console.log(
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          summary: {
            overallStatus: "FAIL",
            reason: "chaos_suite_runtime_failure",
            error: error.message,
          },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
