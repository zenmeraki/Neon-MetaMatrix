// app.js
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import serveStatic from "serve-static";
import cors from "cors";

// Shopify
import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";

// Routes
import productRoutes from "./routes/productRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import SubscriptionRoutes from "./routes/subscriptionRoutes.js";
import SuggestionRoutes from "./routes/suggestionRoutes.js";
import HistoryRoutes from "./routes/historyRoutes.js";
import StoreRoutes from "./routes/storeRoutes.js";
import SyncRoutes from "./routes/syncRoutes.js";
import AffiliateRoutes from "./routes/affiliateRoutes.js";
import LocationRoutes from "./routes/locationRoutes.js";
import intelligenceRoutes from "./routes/intelligenceRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";
import productSavedSegmentRoutes from "./routes/productSavedSegmentRoutes.js";
import automationRoutes from "./routes/automationRoutes.js";

// Socket
import { initSocket } from "./socket.js";
import logger from "./utils/loggerUtils.js";
import {
  appInstallMiddleware,
  shopPreInstallation,
} from "./middleware/appInstallMiddleware.js";
import { maintenanceModeMiddleware } from "./middleware/maintenanceModeMiddleware.js";
import { schemaVersionGateMiddleware } from "./middleware/schemaVersionGateMiddleware.js";

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

function assertUndoDriftPolicy() {
  const strictUndoDriftBlock =
    String(process.env.UNDO_STRICT_DRIFT_BLOCK ?? "true").trim().toLowerCase() !==
    "false";

  if (process.env.NODE_ENV === "production" && !strictUndoDriftBlock) {
    throw new Error(
      "UNDO_STRICT_DRIFT_BLOCK must remain enabled in production",
    );
  }
}

export const buildApp = (_server, io) => {
  assertUndoDriftPolicy();
  const app = express();

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(cors());
  app.set("trust proxy", 1);
  app.use(shopify.cspHeaders());

  // ✅ IMPORTANT: Body parser BEFORE routes
  app.use(express.json({ limit: "300kb" }));
  app.use(compression({ threshold: 1024 }));

  // ✅ Webhooks MUST come AFTER body parser
  app.post(
    shopify.config.webhooks.path,
    shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
  );

  // Socket
  initSocket(io);

  // Auth
  app.get(shopify.config.auth.path, shopPreInstallation, shopify.auth.begin());
  app.get(
    shopify.config.auth.callbackPath,
    shopify.auth.callback(),
    appInstallMiddleware,
    shopify.redirectToShopifyOrAppRoot()
  );

  app.use("/api/*", shopify.validateAuthenticatedSession());
  app.use("/api", maintenanceModeMiddleware);
  app.use("/api", schemaVersionGateMiddleware);

  // ✅ SINGLE rate limiter
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api", apiLimiter);

  // Routes
  app.use("/api/products", productRoutes);
  app.use("/api/products/saved-segments", productSavedSegmentRoutes);
  app.use("/api/automations", automationRoutes);
  app.use("/api/collection", collectionRoutes);
  app.use("/api/suggestion", SuggestionRoutes);
  app.use("/api/subscription", SubscriptionRoutes);
  app.use("/api/history", HistoryRoutes);
  app.use("/api/store", StoreRoutes);
  app.use("/api/location", LocationRoutes);
  app.use("/api/sync", SyncRoutes);
  app.use("/api/intelligence", intelligenceRoutes);
  app.use("/admin", AdminRoutes);
  app.use("/metrics", metricsRoute);
  app.use("/referral", AffiliateRoutes);

  // Frontend
  app.use(
    serveStatic(STATIC_PATH, { index: false, maxAge: "1y", immutable: true })
  );

  const rawIndex = readFileSync(join(STATIC_PATH, "index.html"), "utf-8");
  const indexHTML = rawIndex.replace(
    "%VITE_SHOPIFY_API_KEY%",
    process.env.SHOPIFY_API_KEY
  );

  app.get("/*", shopify.ensureInstalledOnShop(), (_req, res) =>
    res.status(200).type("html").send(indexHTML)
  );

  // Error handler
  app.use((err, req, res, _next) => {
    logger.error({
      err,
      path: req.path,
    });

    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
    });
  });

  
  return app;
};
