import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serveStatic from "serve-static";
import cors from "cors";

import shopify from "./shopify.js";
import ShopifyWebhookHandlers from "./webhooks/shopifyWebhookHandlers.js";

import productRoutes from "./routes/productRoutes.js";
import categorytRoutes from "./routes/categoryRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import SubscriptionRoutes from "./routes/SubscriptionRoutes.js";
import SuggestionRoutes from "./routes/SuggestionRoutes.js";
import HistoryRoutes from "./routes/HistoryRoutes.js";
import StoreRoutes from "./routes/storeRoutes.js";
import SyncRoutes from "./routes/syncRoutes.js";
import LocationRoutes from "./routes/locationRoutes.js";
import automaticProductRuleRoutes from "./routes/automaticProductRuleRoutes.js";
import productCodeSnippetRoutes from "./routes/productCodeSnippetRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";
import performanceRoutes from "./routes/performanceRoutes.js";
import compatRoutes from "./routes/compatRoutes.js";

import { initSocket } from "./socket.js";
import logger from "./utils/loggerUtils.js";
import { requestContextMiddleware } from "./utils/requestContext.js";
import {
  apiLimiter,
  buildCorsOptions,
  getWebhookRawBodyLimit,
  logWebhookIngress,
  requireAdminShop,
  webhookLimiter,
} from "./utils/httpSecurityUtils.js";
import {
  appInstallMiddleware,
  shopPreInstallation,
} from "./middleware/appInstallMiddleware.js";

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

export const buildApp = (_server, io) => {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(cors(buildCorsOptions()));
  app.set("trust proxy", 1);
  app.use(shopify.cspHeaders());
  app.use(requestContextMiddleware);

  app.post(
    shopify.config.webhooks.path,
    webhookLimiter,
    logWebhookIngress,
    express.raw({
      type: "application/json",
      limit: getWebhookRawBodyLimit(),
    }),
    shopify.processWebhooks({ webhookHandlers: ShopifyWebhookHandlers }),
  );

  app.use(express.json({ limit: "300kb" }));
  app.use(compression({ threshold: 1024 }));

  initSocket(io);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      service: "api",
      status: "ok",
      pid: process.pid,
    });
  });

 app.get(
  shopify.config.auth.path,
  (req, res, next) => {
    const shop = String(req.query.shop || "").trim();

    if (!shop || shop === "undefined" || shop === "null") {
      return res.status(400).send("No valid shop provided");
    }

    return next();
  },
  shopPreInstallation,
  shopify.auth.begin(),
);
   app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  appInstallMiddleware,
  shopify.redirectToShopifyOrAppRoot(),
);

  const userSessionAuth = shopify.validateAuthenticatedSession();
  app.use("/api", apiLimiter);
  app.use("/api/products", userSessionAuth, productRoutes);
  app.use("/api/category", userSessionAuth, categorytRoutes);
  app.use("/api/collection", userSessionAuth, collectionRoutes);
  app.use("/api/suggestion", userSessionAuth, SuggestionRoutes);
  app.use("/api/subscription", userSessionAuth, SubscriptionRoutes);
  app.use("/api/history", userSessionAuth, HistoryRoutes);
  app.use("/api/store", userSessionAuth, StoreRoutes);
  app.use("/api/location", userSessionAuth, LocationRoutes);
  app.use("/api/sync", userSessionAuth, SyncRoutes);
  app.use("/api/automatic-rules", userSessionAuth, automaticProductRuleRoutes);
  app.use("/api/product-code-snippets", userSessionAuth, productCodeSnippetRoutes);
  app.use("/api/performance", userSessionAuth, performanceRoutes);
  app.use("/api", userSessionAuth, compatRoutes);
  app.use("/admin", userSessionAuth, requireAdminShop, AdminRoutes);
  app.use("/metrics", metricsRoute);

  app.use(
    serveStatic(STATIC_PATH, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "30d" : "0",
      immutable: false,
    }),
  );

  const rawIndex = readFileSync(join(STATIC_PATH, "index.html"), "utf-8");
  const indexHTML = rawIndex.replace(
    "%VITE_SHOPIFY_API_KEY%",
    process.env.SHOPIFY_API_KEY,
  );

app.get(
  "/*",
  (req, res, next) => {
    const shop = String(req.query.shop || "").trim();

    if (!shop || shop === "undefined" || shop === "null") {
      return res
        .status(400)
        .send("Missing shop parameter. Open app from Shopify Admin.");
    }

    return shopify.ensureInstalledOnShop()(req, res, next);
  },
  (_req, res) => {
    res.status(200).type("html").send(indexHTML);
  },
);

  app.use((err, req, res, _next) => {
    logger.error({
      err,
      requestId: res.getHeader("x-request-id"),
      path: req.path,
    });

    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
    });
  });

  return app;
};
