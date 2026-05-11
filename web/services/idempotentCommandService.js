import { prisma } from "../config/database.js";
import { stableHash } from "../utils/idempotencyKey.js";
import crypto from "crypto";

function normalizeKey(key) {
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export const idempotentCommandService = {
  async begin({
    shop,
    operationType,
    idempotencyKey,
    resourceType = "COMMAND",
  }) {
    const normalizedKey = normalizeKey(idempotencyKey);
    if (!normalizedKey) {
      return { enabled: false };
    }

    const fingerprint = stableHash({
      shop,
      operationType,
      idempotencyKey: normalizedKey,
      resourceType,
    });

    try {
      const row = await prisma.operationFingerprint.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          operationType,
          fingerprint,
          resourceType,
          status: "RESERVED",
        },
      });
      return { enabled: true, created: true, row };
    } catch (_err) {
      const row = await prisma.operationFingerprint.findUnique({
        where: {
          shop_operationType_fingerprint: {
            shop,
            operationType,
            fingerprint,
          },
        },
      });

      if (!row) {
        throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
      }

      return { enabled: true, created: false, row };
    }
  },

  async complete({ id, resourceId = null }) {
    if (!id) return;
    await prisma.operationFingerprint.updateMany({
      where: {
        id,
        status: "RESERVED",
      },
      data: {
        status: "COMPLETED",
        resourceId,
      },
    });
  },

  async fail({ id, message }) {
    if (!id) return;
    await prisma.operationFingerprint.updateMany({
      where: { id },
      data: {
        status: "FAILED",
        lastError: message || null,
      },
    });
  },
};
