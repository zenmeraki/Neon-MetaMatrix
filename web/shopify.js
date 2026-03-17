import {
  BillingInterval,
  LATEST_API_VERSION,
  DeliveryMethod,
} from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";
import dotenv from "dotenv";

dotenv.config();

// Set SSL environment variables that pg will pick up
process.env.PGSSLMODE = 'require';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined – required for Shopify session storage");
}

// Just pass the connection string - the environment variables will handle SSL
const sessionStorage = new PostgreSQLSessionStorage(DATABASE_URL);

export const billingConfig = {
  "Free Version": {
    amount: 0,
    currencyCode: "USD",
    interval: BillingInterval.OneTime,
  },
  "Basic (Monthly)": {
    amount: 10,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  "Advanced (Monthly)": {
    amount: 25,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  "Pro (Monthly)": {
    amount: 50,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
};

const shopify = shopifyApp({
  api: {
    apiVersion: LATEST_API_VERSION,
    future: {
      customerAddressDefaultFix: true,
      lineItemBilling: true,
      unstable_managedPricingSupport: true,
    },
    billing: billingConfig,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
    isOnline: false,
  },
  webhooks: {
    path: "/api/webhooks",
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      async callback(topic, shop, body, webhookId) {
        const payload = JSON.parse(body);
        // noop
      },
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      async callback(topic, shop, body, webhookId) {
        const payload = JSON.parse(body);
      },
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      async callback(topic, shop, body, webhookId) {
        const payload = JSON.parse(body);
      },
    },
    BULK_OPERATIONS_FINISH: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      async callback(topic, shop, body, webhookId) {
        try {
          const payload = JSON.parse(body);
          return {
            success: true,
            message: "Bulk operation job added successfully",
          };
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      },
    },
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      async callback(topic, shop, body, webhookId) {
        try {
          const payload = JSON.parse(body);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
  sessionStorage,
});

export default shopify;