import { DeliveryMethod } from "@shopify/shopify-api";
import crypto from "crypto";
import { addAppUninstallJob } from "./Jobs/Queues/appUninstallJob.js";
import { addbulkOperatonQueryJob } from "./Jobs/Queues/bulkOperationQueryJob.js";
import { addbulkOperatonMutationJob } from "./Jobs/Queues/bulkOperationMutationJob.js";
import { addShopSyncJob } from "./Jobs/Queues/shopSyncJob.js";
import { addProductReconcileJob } from "./Jobs/Queues/productReconcileJob.js";
import { mapPlanKeyFromName } from "./services/SubscriptionService/SubscriptionService.js";
import { processWebhookOnce } from "./services/webhookDeliveryService.js";
import { prisma } from "./config/database.js";
import { clearKeyCaches } from "./utils/cacheUtils.js";
import logger from "./utils/loggerUtils.js";
import { withAdvisoryLock } from "./utils/idempotencyUtils.js";
import { recordProductReconcileSignal } from "./services/productReconcileSignalService.js";
import { MIRROR_SOURCE_KINDS } from "./services/mirrorFreshnessService.js";

function createPayloadHash(body) {
  if (!body) {
    return null;
  }

  return crypto.createHash("sha256").update(String(body)).digest("hex");
}

async function queueProductWebhook({
  topic,
  shop,
  webhookId,
  payload,
  producer,
  entityId,
  body,
}) {
  return processWebhookOnce({
    topic,
    shop,
    webhookId,
    entityId,
    body,
    handler: async () => {
      const payloadHash = createPayloadHash(body);
      const eventTimestamp = payload.updated_at || payload.deleted_at || payload.created_at || null;
      const sourceKind =
        topic === "PRODUCTS_DELETE"
          ? MIRROR_SOURCE_KINDS.WEBHOOK_DELETE
          : topic === "PRODUCTS_CREATE"
            ? MIRROR_SOURCE_KINDS.WEBHOOK_CREATE
            : MIRROR_SOURCE_KINDS.WEBHOOK_UPDATE;

      await recordProductReconcileSignal({
        shop,
        productId: entityId,
        topic,
        webhookId,
        payloadHash,
        sourceUpdatedAt: payload.updated_at || payload.deleted_at || payload.created_at || null,
        sourceEventAt: eventTimestamp,
        sourceKind,
      });

      await producer({
        shop,
        productId: entityId,
        mode: "product",
        topic,
        webhookId,
      });

      await clearKeyCaches(`${shop}:sync_details`);

      return { success: true, message: `${topic} queued` };
    },
  });
}

async function queueShopSyncWebhook({
  topic,
  shop,
  webhookId,
  entityId,
  syncType,
  body,
}) {
  return processWebhookOnce({
    topic,
    shop,
    webhookId,
    entityId,
    body,
    handler: async () => {
      await addShopSyncJob({
        shop,
        syncType,
        reason: topic,
      });

      await clearKeyCaches(`${shop}:sync_details`);

      return { success: true, message: `${topic} queued` };
    },
  });
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
      const payload = JSON.parse(body);

      return processWebhookOnce({
        topic: "SHOP_UPDATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id || payload.email,
        body,
        handler: async () => {
          await prisma.store.updateMany({
            where: { shopUrl: shop },
            data: {
              shopEmail: payload.email || undefined,
              updatedAt: new Date(),
              lastActivityAt: new Date(),
            },
          });

          return { success: true, message: "Shop updated" };
        },
      });
    },
  },

  PRODUCTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      const productId = payload.admin_graphql_api_id;

      return queueProductWebhook({
        topic: "PRODUCTS_CREATE",
        shop,
        webhookId,
        payload,
        producer: addProductReconcileJob,
        entityId: productId,
        body,
      });
    },
  },

  PRODUCTS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      const productId = payload.admin_graphql_api_id || payload.id;

      return queueProductWebhook({
        topic: "PRODUCTS_DELETE",
        shop,
        webhookId,
        payload,
        producer: addProductReconcileJob,
        entityId: productId,
        body,
      });
    },
  },

  PRODUCTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      const productId = payload.admin_graphql_api_id;

      return queueProductWebhook({
        topic: "PRODUCTS_UPDATE",
        shop,
        webhookId,
        payload,
        producer: addProductReconcileJob,
        entityId: productId,
        body,
      });
    },
  },

  COLLECTIONS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_CREATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        body,
      });
    },
  },

  COLLECTIONS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_UPDATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        body,
      });
    },
  },

  COLLECTIONS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_DELETE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
        body,
      });
    },
  },

  INVENTORY_LEVELS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_UPDATE",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        body,
      });
    },
  },

  INVENTORY_ITEMS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_CREATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        body,
      });
    },
  },

  INVENTORY_ITEMS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_UPDATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        body,
      });
    },
  },

  INVENTORY_ITEMS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_ITEMS_DELETE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "product",
        body,
      });
    },
  },

  INVENTORY_LEVELS_CONNECT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_CONNECT",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        body,
      });
    },
  },

  INVENTORY_LEVELS_DISCONNECT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "INVENTORY_LEVELS_DISCONNECT",
        shop,
        webhookId,
        entityId: payload.inventory_item_id || payload.location_id,
        syncType: "product",
        body,
      });
    },
  },

  BULK_OPERATIONS_FINISH: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      const bulkOperationId = payload.admin_graphql_api_id || payload.id;

      return processWebhookOnce({
        topic: "BULK_OPERATIONS_FINISH",
        shop,
        webhookId,
        entityId: bulkOperationId,
        body,
        handler: async () => {
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

          await clearKeyCaches(`${shop}:sync_details`);

          return {
            success: true,
            message: "Bulk operation job queued",
          };
        },
      });
    },
  },

  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      return processWebhookOnce({
        topic,
        shop,
        webhookId,
        entityId: shop,
        body,
        handler: async () => {
          await addAppUninstallJob({
            shop,
            topic,
            webhookId,
            receivedAt: new Date().toISOString(),
            body,
          });

          return {
            success: true,
            message: "App uninstall queued",
          };
        },
      });
    },
  },

  APP_SUBSCRIPTIONS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      try {
        const payload = JSON.parse(body);
        const sub = payload.app_subscription;

        if (!sub) {
          return;
        }

        return processWebhookOnce({
          topic: "APP_SUBSCRIPTIONS_UPDATE",
          shop,
          webhookId,
          entityId: sub.admin_graphql_api_id || sub.name,
          body,
          handler: async () => {
            const { locked } = await withAdvisoryLock(`subscription-webhook:${shop}`, async () => {
              const incomingSubId = sub.admin_graphql_api_id;
              const toDateOrNull = (value) => (value ? new Date(value) : null);
              const existing = await prisma.subscription.findFirst({
                where: { shop },
                orderBy: { createdAt: "asc" },
              });

              if (sub.status === "ACTIVE") {
                const isPendingApproval =
                  existing?.pendingSubscriptionId === incomingSubId;
                const planName = isPendingApproval
                  ? existing?.pendingPlanName || sub.name
                  : sub.name;

                const nextData = {
                  shop,
                  status: "ACTIVE",
                  subscriptionId: incomingSubId,
                  planKey: mapPlanKeyFromName(planName),
                  planName,
                  currentPeriodEnd: toDateOrNull(sub.current_period_end),
                  trialEndsAt: toDateOrNull(sub.trial_ends_at),
                  pendingSubscriptionId: null,
                  pendingPlanKey: null,
                  pendingPlanName: null,
                };

                if (existing) {
                  await prisma.subscription.update({
                    where: { id: existing.id },
                    data: nextData,
                  });
                } else {
                  await prisma.subscription.create({
                    data: nextData,
                  });
                }

                return;
              }

              if (!["CANCELLED", "EXPIRED"].includes(sub.status) || !existing) {
                return;
              }

              if (existing.pendingSubscriptionId === incomingSubId) {
                await prisma.subscription.update({
                  where: { id: existing.id },
                  data: {
                    pendingSubscriptionId: null,
                    pendingPlanKey: null,
                    pendingPlanName: null,
                  },
                });
                return;
              }

              if (
                existing.subscriptionId &&
                existing.subscriptionId !== incomingSubId &&
                existing.status === "ACTIVE"
              ) {
                return;
              }

              await prisma.subscription.update({
                where: { id: existing.id },
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
            });

            if (!locked) {
              return { success: true, message: "Subscription webhook already processing" };
            }

            return { success: true, message: "Subscription webhook processed" };
          },
        });
      } catch (error) {
        logger.error("APP_SUBSCRIPTIONS_UPDATE webhook failed", {
          shop,
          message: error.message,
        });
        throw error;
      }
    },
  },
};
