// controllers/subscriptionController.js

import { getPlansArray, PLANS } from "../services/SubscriptionService/SubscriptionService.js";
import shopify from "../shopify.js";

import { prisma } from "../config/database.js";


export const getPlansController = async (req, res) => {
  try {
    const shop = res.locals.shopify.session?.shop; // injected by auth middleware

    if (!shop) {
      return res.status(401).json({
        success: false,
        message: "Shopify session missing",
      });
    }

    // 1️⃣ Fetch current subscription (if any) – Prisma
    const subscription = await prisma.subscription.findFirst({
      where: { shop },
    });

    const currentPlanKey =
      subscription && subscription.status === "ACTIVE"
        ? subscription.planKey
        : "FREE";

    // 2️⃣ Build plans response
    const plans = getPlansArray().map((plan) => ({
      ...plan,
      isCurrent: plan.key === currentPlanKey,
    }));

    return res.status(200).json({
      success: true,
      currentPlanKey,
      plans,
    });
  } catch (error) {
    console.error("[GET_PLANS] Error while fetching plans:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch plans",
    });
  }
};

export const createSubscriptionController = async (req, res) => {
  try {
    const { planKey, returnUrl } = req.body;
    const session = res.locals.shopify.session;

    if (!session?.shop) {
      return res.status(401).json({
        success: false,
        message: "Shopify session missing",
      });
    }

    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan selected",
      });
    }

    // ✅ HANDLE FREE PLAN - Cancel active subscription
    if (plan.isFree) {
      const existingSub = await prisma.subscription.findFirst({
        where: { shop: session.shop },
      });

      if (existingSub && existingSub.subscriptionId && existingSub.status === "ACTIVE") {
        console.log(
          `[BILLING] Cancelling subscription to switch to FREE: ${existingSub.subscriptionId}`,
        );

        const client = new shopify.api.clients.Graphql({ session });
        const cancelMutation = `
          mutation CancelSubscription($id: ID!) {
            appSubscriptionCancel(id: $id) {
              userErrors { 
                field
                message 
              }
              appSubscription { 
                id 
                status
              }
            }
          }
        `;

        try {
          const cancelResult = await client.query({
            data: {
              query: cancelMutation,
              variables: { id: existingSub.subscriptionId },
            },
          });

          const cancelData = cancelResult.body.data.appSubscriptionCancel;

          if (cancelData.userErrors && cancelData.userErrors.length > 0) {
            console.error("[BILLING] Error cancelling subscription:", cancelData.userErrors);
            return res.status(400).json({
              success: false,
              message: cancelData.userErrors[0].message,
            });
          }

          // 🔁 Update existing subscription to FREE via Prisma
          await prisma.subscription.update({
            where: { id: existingSub.id },
            data: {
              status: "FREE",
              planKey: "FREE",
              planName: "Free Plan",
              subscriptionId: null,
              currentPeriodEnd: null,
              trialEndsAt: null,
              pendingSubscriptionId: null, // Clear any pending
              pendingPlanKey: null,
              pendingPlanName: null,
            },
          });
        } catch (cancelError) {
          console.error("[BILLING] Exception while cancelling subscription:", cancelError);
          return res.status(500).json({
            success: false,
            message: "Failed to cancel subscription",
          });
        }
      } else {
        // No active sub – set/create FREE subscription
        const existing = await prisma.subscription.findFirst({
          where: { shop: session.shop },
        });

        if (existing) {
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
        } else {
          await prisma.subscription.create({
            data: {
              shop: session.shop,
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
        }
      }

      return res.status(200).json({
        success: true,
        message: "Free plan activated",
        confirmationUrl: null,
      });
    }

    // ✅ HANDLE PAID PLANS - Store as PENDING, don't touch active subscription
    const client = new shopify.api.clients.Graphql({ session });

    const mutation = `
      mutation CreateSubscription(
        $name: String!
        $returnUrl: URL!
        $trialDays: Int!
        $price: Decimal!
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          trialDays: $trialDays
          lineItems: [{
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $price, currencyCode: USD }
                interval: EVERY_30_DAYS
              }
            }
          }]
        ) {
          appSubscription { 
            id 
            status 
          }
          confirmationUrl
          userErrors { 
            field
            message 
          }
        }
      }
    `;

    const result = await client.query({
      data: {
        query: mutation,
        variables: {
          name: plan.name,
          returnUrl:
            returnUrl ||
            `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
          trialDays: plan.trialDays,
          price: plan.price.toString(),
        },
      },
    });

    const data = result.body.data.appSubscriptionCreate;

    if (data.userErrors && data.userErrors.length > 0) {
      console.error("[CREATE_SUBSCRIPTION] Errors:", data.userErrors);
      return res.status(400).json({
        success: false,
        message: data.userErrors[0].message,
      });
    }

    // 👇 ONLY store pending subscription info, don't touch active subscription
    const existingSub = await prisma.subscription.findFirst({
      where: { shop: session.shop },
    });

    if (existingSub) {
      await prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          pendingSubscriptionId: data.appSubscription.id,
          pendingPlanKey: planKey,
          pendingPlanName: plan.name,
          // DON'T update subscriptionId, status, planKey - keep existing active subscription!
        },
      });
    } else {
      await prisma.subscription.create({
        data: {
          shop: session.shop,
          status: "PENDING", // or "FREE", but you previously default to FREE in schema
          pendingSubscriptionId: data.appSubscription.id,
          pendingPlanKey: planKey,
          pendingPlanName: plan.name,
        },
      });
    }

    console.log(
      `[BILLING] Created pending subscription: ${data.appSubscription.id} for plan: ${plan.name}`,
    );

    return res.status(200).json({
      success: true,
      confirmationUrl: data.confirmationUrl,
      subscriptionId: data.appSubscription.id,
    });
  } catch (error) {
    console.error("[CREATE_SUBSCRIPTION] Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create subscription",
    });
  }
};