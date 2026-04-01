import { DeliveryMethod } from "@shopify/shopify-api";
import { addProductCreateJob } from "./Jobs/Queues/productCreateJob.js";
import { addProductUpdateJob } from "./Jobs/Queues/productUpdateJob.js";
import { addProductDeleteJob } from "./Jobs/Queues/productDeleteJob.js";
import { addAppUninstallJob } from "./Jobs/Queues/appUninstallJob.js";
import { addbulkOperatonQueryJob } from "./Jobs/Queues/bulkOperationQueryJob.js";
import { addbulkOperatonMutationJob } from "./Jobs/Queues/bulkOperationMutationJob.js";
import { addShopSyncJob } from "./Jobs/Queues/shopSyncJob.js";
import CacheService from "./utils/cacheService.js";
import { mapPlanKeyFromName } from "./services/SubscriptionService/SubscriptionService.js";
import { prisma } from "./config/database.js";
import { clearAllCachesForShop, clearKeyCaches } from "./utils/cacheUtils.js";
import { clearShopSessions } from "./utils/sessionHandler.js";
import logger from "./utils/loggerUtils.js";

function webhookDedupeKey({ topic, shop, webhookId, entityId }) {
  return `webhook:${topic}:${shop}:${webhookId || entityId || "unknown"}`;
}

async function reserveWebhook(topic, shop, webhookId, entityId) {
  const key = webhookDedupeKey({ topic, shop, webhookId, entityId });
  const existing = await CacheService.get(key);

  if (existing) {
    return false;
  }

  await CacheService.set(key, Date.now(), 300);
  return true;
}

async function queueProductWebhook({
  topic,
  shop,
  webhookId,
  payload,
  producer,
  entityId,
}) {
  const reserved = await reserveWebhook(topic, shop, webhookId, entityId);
  if (!reserved) {
    return { success: true, message: "Duplicate ignored" };
  }

  await producer({
    ...payload,
    shop,
    webhookId,
    id: entityId,
  });

  await clearKeyCaches(`${shop}:sync_details`);

  return { success: true, message: `${topic} queued` };
}

async function queueShopSyncWebhook({
  topic,
  shop,
  webhookId,
  entityId,
  syncType,
}) {
  const reserved = await reserveWebhook(topic, shop, webhookId, entityId);
  if (!reserved) {
    return { success: true, message: "Duplicate ignored" };
  }

  await addShopSyncJob({
    shop,
    syncType,
    reason: topic,
  });

  await clearKeyCaches(`${shop}:sync_details`);

  return { success: true, message: `${topic} queued` };
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
    callback: async (_topic, shop, body) => {
      const payload = JSON.parse(body);

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
        producer: addProductCreateJob,
        entityId: productId,
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
      const payload = JSON.parse(body);
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
      const payload = JSON.parse(body);
      return queueShopSyncWebhook({
        topic: "COLLECTIONS_CREATE",
        shop,
        webhookId,
        entityId: payload.admin_graphql_api_id || payload.id,
        syncType: "collection",
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
      });
    },
  },

  BULK_OPERATIONS_FINISH: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      const bulkOperationId = payload.admin_graphql_api_id || payload.id;
      const reserved = await reserveWebhook(
        "BULK_OPERATIONS_FINISH",
        shop,
        webhookId,
        bulkOperationId,
      );

      if (!reserved) {
        return { success: true, message: "Duplicate ignored" };
      }

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
  },

  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      const reserved = await reserveWebhook(topic, shop, webhookId, "app_uninstalled");
      if (!reserved) {
        return {
          success: true,
          message: "Duplicate ignored",
        };
      }

      const receivedAt = new Date().toISOString();

      await prisma.store.updateMany({
        where: { shopUrl: shop },
        data: {
          isUnInstalled: true,
          unInstalledAt: new Date(receivedAt),
          accessToken: null,
          scope: null,
          activeMirrorBatchId: null,
          activeCollectionBatchId: null,
          isProductSyncing: false,
          isCollectionSyncing: false,
          isProductTypeSyncing: false,
          isProductInitialySyning: false,
          shopifyBulkJobCompleted: false,
          syncProgressStage: "IDLE",
          productInitialSyncProgress: 0,
          storeTotalProducts: 0,
        },
      });

      await clearShopSessions(shop).catch(() => {});
      await clearAllCachesForShop(shop).catch(() => {});

      await addAppUninstallJob({
        shop,
        topic,
        webhookId,
        receivedAt,
        body,
      });

      return {
        success: true,
        message: "App uninstall queued",
      };
    },
  },

  APP_SUBSCRIPTIONS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop, body) => {
      try {
        const payload = JSON.parse(body);
        const sub = payload.app_subscription;

        if (!sub) {
          return;
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

          return;
        }

        if (!["CANCELLED", "EXPIRED"].includes(sub.status)) {
          return;
        }

        if (!existing) {
          return;
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
          return;
        }

        if (
          existing.subscriptionId &&
          existing.subscriptionId !== incomingSubId &&
          existing.status === "ACTIVE"
        ) {
          return;
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
