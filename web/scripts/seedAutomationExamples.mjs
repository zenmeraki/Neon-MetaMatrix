import { prisma } from "../config/database.js";
import { createAutomationRule } from "../services/automation/automationRuleService.js";

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args[key] = rest.join("=");
  }
  return args;
}

async function createIfMissing({ shop, payload }) {
  const existing = await prisma.automationRule.findFirst({
    where: {
      shop,
      name: payload.name,
    },
    select: { id: true, status: true },
  });

  if (existing) {
    return { created: false, id: existing.id, name: payload.name };
  }

  const created = await createAutomationRule({
    shop,
    name: payload.name,
    triggerType: payload.triggerType,
    triggerConfig: payload.triggerConfig || {},
    ruleAstJson: payload.ruleAstJson,
    actionsJson: payload.actionsJson,
    dryRunFirst: true,
    cooldownSeconds: 300,
    maxRunsPerDay: 24,
  });

  return { created: true, id: created.id, name: created.name };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shop = String(args.shop || "").trim();

  if (!shop) {
    throw new Error("Usage: node web/scripts/seedAutomationExamples.mjs --shop=<shop.myshopify.com>");
  }

  const examples = [
    {
      name: "Low stock protection",
      triggerType: "ON_SYNC_COMPLETED",
      ruleAstJson: {
        type: "group",
        op: "AND",
        children: [
          {
            type: "condition",
            field: "variant.inventoryQuantity",
            operator: "lt",
            value: 3,
          },
          {
            type: "condition",
            field: "product.status",
            operator: "eq",
            value: "ACTIVE",
          },
        ],
      },
      actionsJson: [
        {
          type: "BULK_EDIT",
          status: "ENABLED",
          maxTargets: 10000,
          operation: {
            field: "product.tags",
            action: "append",
            value: "low-stock",
          },
        },
        {
          type: "BULK_EDIT",
          status: "ENABLED",
          maxTargets: 10000,
          operation: {
            field: "variant.price",
            action: "increaseBy",
            value: 5,
            options: {
              money: {
                mode: "percent",
              },
            },
          },
        },
      ],
    },
    {
      name: "Normalize Nike vendor",
      triggerType: "ON_SYNC_COMPLETED",
      ruleAstJson: {
        type: "condition",
        field: "product.vendor",
        operator: "in",
        value: ["NIKE", "nike", "Nike Inc", "Nike "],
      },
      actionsJson: [
        {
          type: "BULK_EDIT",
          status: "ENABLED",
          maxTargets: 10000,
          operation: {
            field: "product.vendor",
            action: "set",
            value: "Nike",
          },
        },
      ],
    },
    {
      name: "Missing SEO title",
      triggerType: "ON_SYNC_COMPLETED",
      ruleAstJson: {
        type: "condition",
        field: "product.seoTitle",
        operator: "is_empty",
        value: null,
      },
      actionsJson: [
        {
          type: "BULK_EDIT",
          status: "ENABLED",
          maxTargets: 10000,
          operation: {
            field: "product.tags",
            action: "append",
            value: "needs-seo",
          },
        },
      ],
    },
  ];

  const results = [];
  for (const payload of examples) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await createIfMissing({ shop, payload }));
  }

  console.log(
    JSON.stringify(
      {
        shop,
        seeded: results,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
