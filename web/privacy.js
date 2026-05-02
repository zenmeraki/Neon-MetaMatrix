import { DeliveryMethod } from "@shopify/shopify-api";
import { addProductCreateJob } from "./Jobs/Queues/productCreateJob.js";
import { addProductUpdateJob } from "./Jobs/Queues/productUpdateJob.js";
import { addProductDeleteJob } from "./Jobs/Queues/productDeleteJob.js";
import { addAppUninstallJob } from "./Jobs/Queues/appUninstallJob.js";
import { addbulkOperatonQueryJob } from "./Jobs/Queues/bulkOperationQueryJob.js";
import { addbulkOperatonMutationJob } from "./Jobs/Queues/bulkOperationMutationJob.js";
import { addShopSyncJob } from "./Jobs/Queues/shopSyncJob.js";
import { mapPlanKeyFromName } from "./services/SubscriptionService/SubscriptionService.js";
import { prisma } from "./config/database.js";
import { clearKeyCaches } from "./utils/cacheUtils.js";
import logger from "./utils/loggerUtils.js";
import crypto from "crypto";


function safeParseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function createPayloadHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");
}

function normalizeWebhookEntityId(payload) {
  return (
    payload?.admin_graphql_api_id ||
    payload?.id ||
    payload?.inventory_item_id ||
    payload?.location_id ||
    null
  );
}

function buildWebhookDeliveryId({ topic, shop, webhookId, entityId }) {
  return webhookId || `${topic}:${shop}:${entityId || "unknown"}`;
}

function buildWebhookDedupeKey({ topic, shop, webhookId, entityId }) {
  return `webhook:${topic}:${shop}:${webhookId || entityId || "unknown"}`;
}

async function reserveWebhookDelivery({
  topic,
  shop,
  webhookId,
  entityId,
  payload,
}) {
  const id = buildWebhookDeliveryId({ topic, shop, webhookId, entityId });
  const dedupeKey = buildWebhookDedupeKey({ topic, shop, webhookId, entityId });
  const payloadHash = createPayloadHash(payload);

  try {
    await prisma.webhookDelivery.create({
      data: {
        id,
        topic,
        shop,
        webhookId: webhookId || null,
        entityId: entityId || null,
        dedupeKey,
        payloadHash,
        status: "RECEIVED",
        attemptCount: 1,
      },
    });

    return { accepted: true, deliveryId: id, payloadHash };
  } catch (error) {
    return { accepted: false, deliveryId: id, payloadHash };
  }
}

async function markWebhookQueued(deliveryId) {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "QUEUED",
      updatedAt: new Date(),
    },
  }).catch(() => {});
}

async function markWebhookProcessed(deliveryId) {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      updatedAt: new Date(),
    },
  }).catch(() => {});
}

async function markWebhookFailed(deliveryId, error) {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "FAILED",
      lastError: error?.message || String(error),
      updatedAt: new Date(),
    },
  }).catch(() => {});
}

async function upsertReconcileSignal({
  shop,
  entityType,
  entityId,
  topic,
  payloadHash,
  webhookId,
}) {
  if (!shop || !entityType || !entityId) return;

  const signalId = `${shop}:${entityType}:${entityId}`;

  await prisma.mirrorReconcileSignal.upsert({
    where: { id: signalId },
    create: {
      id: signalId,
      shop,
      entityType,
      entityId,
      topic,
      status: "pending",
      signalCount: 1,
      latestWebhookId: webhookId || null,
      latestPayloadHash: payloadHash || null,
      latestEventAt: new Date(),
      latestSourceKind: topic,
      updatedAt: new Date(),
    },
    update: {
      topic,
      status: "pending",
      signalCount: { increment: 1 },
      latestWebhookId: webhookId || null,
      latestPayloadHash: payloadHash || null,
      latestEventAt: new Date(),
      latestSourceKind: topic,
      updatedAt: new Date(),
    },
  });
}

async function queueProductWebhook({
  topic,
  shop,
  webhookId,
  payload,
  producer,
  entityId,
}) {
  const reservation = await reserveWebhookDelivery({
    topic,
    shop,
    webhookId,
    entityId,
    payload,
  });

  if (!reservation.accepted) {
    return { success: true, message: "Duplicate ignored" };
  }

  try {
    await upsertReconcileSignal({
      shop,
      entityType: "product",
      entityId,
      topic,
      payloadHash: reservation.payloadHash,
      webhookId,
    });

    await producer({
      ...payload,
      shop,
      webhookId,
      id: entityId,
    });

    await markWebhookQueued(reservation.deliveryId);
    await clearKeyCaches(`${shop}:sync_details`);

    return { success: true, message: `${topic} queued` };
  } catch (error) {
    await markWebhookFailed(reservation.deliveryId, error);
    throw error;
  }
}

async function queueShopSyncWebhook({
  topic,
  shop,
  webhookId,
  entityId,
  syncType,
  entityType = "shop_scope",
  payload = {},
}) {
  const reservation = await reserveWebhookDelivery({
    topic,
    shop,
    webhookId,
    entityId,
    payload,
  });

  if (!reservation.accepted) {
    return { success: true, message: "Duplicate ignored" };
  }

  try {
    await upsertReconcileSignal({
      shop,
      entityType,
      entityId: String(entityId || syncType || "shop"),
      topic,
      payloadHash: reservation.payloadHash,
      webhookId,
    });

    await addShopSyncJob({
      shop,
      syncType,
      reason: topic,
    });

    await markWebhookQueued(reservation.deliveryId);
    await clearKeyCaches(`${shop}:sync_details`);

    return { success: true, message: `${topic} queued` };
  } catch (error) {
    await markWebhookFailed(reservation.deliveryId, error);
    throw error;
  }
}

export default {
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => ({ success: true }),
  },

  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => ({ success: true }),
  },

  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => ({ success: true }),
  },

  SHOP_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const entityId = normalizeWebhookEntityId(payload) || shop;

      const reservation = await reserveWebhookDelivery({
        topic: "SHOP_UPDATE",
        shop,
        webhookId,
        entityId,
        payload,
      });

      if (!reservation.accepted) {
        return { success: true, message: "Duplicate ignored" };
      }

      try {
        await prisma.store.updateMany({
          where: { shopUrl: shop },
          data: {
            shopEmail: payload.email || undefined,
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          },
        });

        await markWebhookProcessed(reservation.deliveryId);
        return { success: true, message: "Shop updated" };
      } catch (error) {
        await markWebhookFailed(reservation.deliveryId, error);
        throw error;
      }
    },
  },

  PRODUCTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const productId = payload.admin_graphql_api_id;

      return queueProductWebhook({
        topic: "PRODUCTS_CREATE",
        shop,
        webhookId,
        payload,
        producer: addProductCreateJob,
        entityId: productId,
      });
    },
  },

  PRODUCTS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const productId = payload.admin_graphql_api_id || payload.id;

      return queueProductWebhook({
        topic: "PRODUCTS_DELETE",
        shop,
        webhookId,
        payload: {},
        producer: addProductDeleteJob,
        entityId: productId,
      });
    },
  },

  PRODUCTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const productId = payload.admin_graphql_api_id;

      return queueProductWebhook({
        topic: "PRODUCTS_UPDATE",
        shop,
        webhookId,
        payload,
        producer: addProductUpdateJob,
        entityId: productId,
      });
    },
  },

  COLLECTIONS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_CREATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        entityType: "collection",
        payload,
      });
    },
  },

  COLLECTIONS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_UPDATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        entityType: "collection",
        payload,
      });
    },
  },

  COLLECTIONS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_DELETE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        entityType: "collection",
        payload,
      });
    },
  },

  INVENTORY_LEVELS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_UPDATE",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  INVENTORY_ITEMS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_CREATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  INVENTORY_ITEMS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_UPDATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  INVENTORY_ITEMS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_DELETE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  INVENTORY_LEVELS_CONNECT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_CONNECT",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  INVENTORY_LEVELS_DISCONNECT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_DISCONNECT",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        entityType: "inventory_item",
        payload,
      });
    },
  },

  BULK_OPERATIONS_FINISH: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const bulkOperationId = payload.admin_graphql_api_id || payload.id;

      const reservation = await reserveWebhookDelivery({
        topic: "BULK_OPERATIONS_FINISH",
        shop,
        webhookId,
        entityId: bulkOperationId,
        payload,
      });

      if (!reservation.accepted) {
        return { success: true, message: "Duplicate ignored" };
      }

      try {
        const jobData = {
          ...payload,
          shop,
          webhookId,
        };

        if (String(payload.type || "").toLowerCase() === "mutation") {
          await addbulkOperatonMutationJob(jobData);
        } else {
          await addbulkOperatonQueryJob(jobData);
        }

        await markWebhookQueued(reservation.deliveryId);
        await clearKeyCaches(`${shop}:sync_details`);

        return {
          success: true,
          message: "Bulk operation job queued",
        };
      } catch (error) {
        await markWebhookFailed(reservation.deliveryId, error);
        throw error;
      }
    },
  },

  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);

      const reservation = await reserveWebhookDelivery({
        topic,
        shop,
        webhookId,
        entityId: shop,
        payload,
      });

      if (!reservation.accepted) {
        return { success: true, message: "Duplicate ignored" };
      }

      try {
        await addAppUninstallJob({
          shop,
          topic,
          webhookId,
          receivedAt: new Date().toISOString(),
          body,
        });

        await markWebhookQueued(reservation.deliveryId);

        return {
          success: true,
          message: "App uninstall queued",
        };
      } catch (error) {
        await markWebhookFailed(reservation.deliveryId, error);
        throw error;
      }
    },
  },

  APP_SUBSCRIPTIONS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = safeParseJson(body);
      const sub = payload.app_subscription;

      const reservation = await reserveWebhookDelivery({
        topic: "APP_SUBSCRIPTIONS_UPDATE",
        shop,
        webhookId,
        entityId: sub?.admin_graphql_api_id || shop,
        payload,
      });

      if (!reservation.accepted) {
        return { success: true, message: "Duplicate ignored" };
      }

      try {
        if (!sub) {
          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        const incomingSubId = sub.admin_graphql_api_id;
        const existing = await prisma.subscription.findFirst({
          where: { shop },
        });

        const toDateOrNull = (value) => (value ? new Date(value) : null);

        if (sub.status === "ACTIVE") {
          const isPendingApproval =
            existing?.pendingSubscriptionId === incomingSubId;

          if (isPendingApproval && existing) {
            await prisma.subscription.updateMany({
              where: { shop },
              data: {
                status: "ACTIVE",
                subscriptionId: incomingSubId,
                planKey: existing.pendingPlanKey,
                planName: existing.pendingPlanName || sub.name,
                currentPeriodEnd: toDateOrNull(sub.current_period_end),
                trialEndsAt: toDateOrNull(sub.trial_ends_at),
                pendingSubscriptionId: null,
                pendingPlanKey: null,
                pendingPlanName: null,
              },
            });
          } else {
            const planKey = mapPlanKeyFromName(sub.name);

            if (existing) {
              await prisma.subscription.updateMany({
                where: { shop },
                data: {
                  status: "ACTIVE",
                  subscriptionId: incomingSubId,
                  planKey,
                  planName: sub.name,
                  currentPeriodEnd: toDateOrNull(sub.current_period_end),
                  trialEndsAt: toDateOrNull(sub.trial_ends_at),
                },
              });
            } else {
              await prisma.subscription.create({
                data: {
                  shop,
                  status: "ACTIVE",
                  subscriptionId: incomingSubId,
                  planKey,
                  planName: sub.name,
                  currentPeriodEnd: toDateOrNull(sub.current_period_end),
                  trialEndsAt: toDateOrNull(sub.trial_ends_at),
                },
              });
            }
          }

          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        if (!["CANCELLED", "EXPIRED"].includes(sub.status)) {
          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        if (!existing) {
          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        if (existing.pendingSubscriptionId === incomingSubId) {
          await prisma.subscription.updateMany({
            where: { shop },
            data: {
              pendingSubscriptionId: null,
              pendingPlanKey: null,
              pendingPlanName: null,
            },
          });

          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        if (
          existing.subscriptionId &&
          existing.subscriptionId !== incomingSubId &&
          existing.status === "ACTIVE"
        ) {
          await markWebhookProcessed(reservation.deliveryId);
          return { success: true };
        }

        await prisma.subscription.updateMany({
          where: {
            shop,
            subscriptionId: incomingSubId,
            pendingSubscriptionId: null,
          },
          data: {
            status: "FREE",
            planKey: "FREE",
            planName: "Free Plan",
            subscriptionId: null,
            currentPeriodEnd: null,
            trialEndsAt: null,
            pendingSubscriptionId: null,
            pendingPlanKey: null,
            pendingPlanName: null,
          },
        });

        await markWebhookProcessed(reservation.deliveryId);
        return { success: true };
      } catch (error) {
        await markWebhookFailed(reservation.deliveryId, error);
        logger.error("APP_SUBSCRIPTIONS_UPDATE webhook failed", {
          shop,
          message: error.message,
        });
        throw error;
      }
    },
  },
};