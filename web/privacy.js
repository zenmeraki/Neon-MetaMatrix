//pr
import { DeliveryMethod } from "@shopify/shopify-api";
import shopify from "./shopify.js";
import { addProductUpdateJob } from "./Jobs/Queues/productUpdateJob.js";
import { addProductDeleteJob } from "./Jobs/Queues/productDeleteJob.js";
import CacheService from "./utils/cacheService.js";
import { addAppUninstallJob } from "./Jobs/Queues/appUninstallJob.js";
import { addbulkOperatonQueryJob } from "./Jobs/Queues/bulkOperationQueryJob.js";
import { mapPlanKeyFromName } from "./services/SubscriptionService/SubscriptionService.js";
import {prisma} from "./config/database.js"
import { clearKeyCaches } from "./utils/cacheUtils.js";
import { addbulkOperatonMutationJob } from "./Jobs/Queues/bulkOperationMutationJob.js";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
    },
  },

  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
    },
  },

  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      return;
    },
  },

  PRODUCTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const payload = JSON.parse(body);
        const productId = payload.admin_graphql_api_id;
        const key = `productCreate:${shop}:${productId}`;

        // Check for duplicate webhooks (Shopify can send duplicates)
        const existing = await CacheService.get(key);
        if (existing) {
          return { success: true, message: "Duplicate ignored" };
        }
        // Mark as processed (30 second window to catch duplicates)
        await CacheService.set(key, Date.now(), 30);
        await addProductCreateJob(
          { ...payload, shop, id: productId },
          {
            // Job options
            priority: 10,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 2000,
            },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );
        await clearKeyCaches(`${shop}:sync_details`);

        return {
          success: true,
          message: "Product update queued",
        };
      } catch (error) {
        return {
          success: false,
          message: error.message,
        };
      }
    },
  },

  PRODUCTS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const payload = JSON.parse(body);
        const productId = payload.id;
        const key = `productDelete:${shop}:${productId}`;

        // Check for duplicate webhooks (Shopify can send duplicates)
        const existing = await CacheService.get(key);
        if (existing) {
          return { success: true, message: "Duplicate ignored" };
        }
        // Mark as processed (30 second window to catch duplicates)
        await CacheService.set(key, Date.now(), 30);

        await addProductDeleteJob(
          { id: productId, shop },
          {
            // Job options
            priority: 10,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 2000,
            },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );
        await clearKeyCaches(`${shop}:sync_details`);

        return;
      } catch (err) {
        throw new Error(err.message);
      }
    },
  },

  PRODUCTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const payload = JSON.parse(body);
        const productId = payload.admin_graphql_api_id;
        const key = `productUpdate:${shop}:${productId}`;

        // Check for duplicate webhooks (Shopify can send duplicates)
        const existing = await CacheService.get(key);
        if (existing) {
          return { success: true, message: "Duplicate ignored" };
        }
        // Mark as processed (30 second window to catch duplicates)
        await CacheService.set(key, Date.now(), 30);
        await addProductUpdateJob(
          {
            ...payload,
            shop,
            id: productId,
          },
          {
            // Job options
            priority: 10,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 2000,
            },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );
        await clearKeyCaches(`${shop}:sync_details`);

        return {
          success: true,
          message: "Product update queued",
        };
      } catch (error) {
        return {
          success: false,
          message: error.message,
        };
      }
    },
  },

  BULK_OPERATIONS_FINISH: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const payload = JSON.parse(body);
        if (payload.type == "mutation") {
          await addbulkOperatonMutationJob({ ...payload, shop });
        } else {
          console.log("got sync webhook for " + shop);
          await addbulkOperatonQueryJob({ ...payload, shop });
        }
        await clearKeyCaches(`${shop}:sync_details`);
        return {
          success: true,
          message: "Bulk operation job added successfully",
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },

  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      try {
        // Add job to queue
        await addAppUninstallJob(
          {
            shop,
            body,
            webhookId,
            topic,
            receivedAt: new Date().toISOString(),
          },
          {
            priority: 5,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          }
        );

        return {
          success: true,
          message: "App uninstall queued for processing",
        };
      } catch (error) {
        console.error("❌ Error queueing app uninstall:", error);
        throw new Error(error.message);
      }
    },
  },

APP_SUBSCRIPTIONS_UPDATE: {
  deliveryMethod: DeliveryMethod.Http,
  callbackUrl: "/api/webhooks",
  callback: async (topic, shop, body) => {
    try {
      console.log("🔔 ========== SUBSCRIPTION WEBHOOK RECEIVED ==========");
      console.log("Shop:", shop);
      console.log("Raw body:", body);

      const payload = JSON.parse(body);
      const sub = payload.app_subscription;

      if (!sub) {
        console.log("❌ No app_subscription in payload");
        return;
      }

      console.log("📦 Subscription data:", {
        id: sub.admin_graphql_api_id,
        status: sub.status,
        name: sub.name,
        current_period_end: sub.current_period_end,
        trial_ends_at: sub.trial_ends_at,
      });

      const incomingSubId = sub.admin_graphql_api_id;

      // 🔄 Load existing subscription via Prisma
      const existing = await prisma.subscription.findFirst({
        where: { shop },
      });

      console.log("💾 Database comparison:", {
        "DB subscriptionId": existing?.subscriptionId,
        "DB pendingSubscriptionId": existing?.pendingSubscriptionId,
        "Incoming subId": incomingSubId,
        "DB status": existing?.status,
        "DB planKey": existing?.planKey,
      });

      // Small helper for date parsing (Shopify → DateTime)
      const toDateOrNull = (value) => (value ? new Date(value) : null);

      // 🟢 CASE 1: ACTIVE subscription
      if (sub.status === "ACTIVE") {
        console.log("✅ Processing ACTIVE subscription");

        const isPendingApproval =
          existing?.pendingSubscriptionId === incomingSubId;

        // 1A. Pending → ACTIVE: upgrade/downgrade approved
        if (isPendingApproval && existing) {
          console.log(
            "🎉 Pending subscription approved! Upgrading/downgrading plan.",
          );

         
          // Activate the new subscription; clear pending fields
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

          
          console.log(`✅ [BILLING] ${shop} upgraded to ${sub.name}`);
        } else {
          // 1B. Regular ACTIVE subscription (not linked to pending)
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

          console.log(`✅ [BILLING] ${shop} ACTIVE → ${sub.name}`);
        }

        return;
      }

      // 🟡 CASE 2: CANCELLED / EXPIRED
      if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
        console.log(`⚠️ Processing ${sub.status} subscription`);

        if (!existing) {
          console.log("❌ BLOCKED: No existing subscription in database");
          return;
        }

        // 2A. Pending subscription cancelled (user backed out)
        if (existing.pendingSubscriptionId === incomingSubId) {
          console.log(
            "⚠️ User declined pending subscription, clearing pending fields",
          );

          await prisma.subscription.updateMany({
            where: { shop },
            data: {
              pendingSubscriptionId: null,
              pendingPlanKey: null,
              pendingPlanName: null,
            },
          });

          console.log(
            "✅ Pending subscription cleared, active subscription preserved",
          );
          return;
        }

        // 2B. Already FREE + no Stripe/app subscription id – nothing to do
        if (existing.status === "FREE" && !existing.subscriptionId) {
          console.log("✅ Already downgraded to FREE");
          return;
        }

        // 2C. Safety: Ensure webhook sub-id matches DB sub-id
        if (
          existing.subscriptionId !== incomingSubId &&
          existing.status === "ACTIVE" &&
          existing.subscriptionId
        ) {
          console.log(
            "Ignoring cancellation for replaced subscription during plan change",
          );
          console.log(`   Active subscription: ${existing.subscriptionId}`);
          console.log(`   Cancelled webhook:   ${incomingSubId}`);
          console.log(`   Active plan:         ${existing.planKey}`);
          return;
        }

        if (existing.subscriptionId !== incomingSubId) {
          console.log("❌ BLOCKED: Subscription ID mismatch!");
          console.log(`   Expected: ${existing.subscriptionId}`);
          console.log(`   Got:      ${incomingSubId}`);
          return;
        }

        console.log("✅ IDs match, proceeding with downgrade");

        if (
          existing.pendingSubscriptionId &&
          existing.pendingSubscriptionId !== incomingSubId
        ) {
          console.log(
            "Ignoring cancellation because a replacement subscription is still pending",
          );
          console.log(`   Active subscription:   ${existing.subscriptionId}`);
          console.log(`   Pending replacement:   ${existing.pendingSubscriptionId}`);
          console.log(`   Cancelled webhook:     ${incomingSubId}`);
          return;
        }

        // Downgrade to FREE plan
        const downgradeResult = await prisma.subscription.updateMany({
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

        console.log(`✅ [BILLING] ${shop} downgraded to FREE`);
      }

      console.log("========== WEBHOOK PROCESSING COMPLETE ==========");
    } catch (error) {
      console.error("❌ [WEBHOOK ERROR] APP_SUBSCRIPTIONS_UPDATE", error);
      throw error;
    }
  },
},
};


