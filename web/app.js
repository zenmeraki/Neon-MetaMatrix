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
import SubscriptionRoutes from "./routes/SubscriptionRoutes.js";
import SuggestionRoutes from "./routes/SuggestionRoutes.js";
import HistoryRoutes from "./routes/HistoryRoutes.js";
import StoreRoutes from "./routes/storeRoutes.js";
import SyncRoutes from "./routes/syncRoutes.js";
import AffiliateRoutes from "./routes/affiliateRoutes.js";
import LocationRoutes from "./routes/locationRoutes.js";
import intelligenceRoutes from "./routes/intelligenceRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";

// Socket
import { initSocket } from "./socket.js";
import logger from "./utils/loggerUtils.js";
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

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
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

  // ✅ SINGLE rate limiter
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      process.env.NODE_ENV !== "production" ||
      req.path === "/sync/sync-status" ||
      req.path === "/sync/product-track" ||
      req.path === "/products/get-all",
    keyGenerator: (req, res) =>
      res.locals.shopify?.session?.shop ||
      req.get("x-shopify-shop-domain") ||
      req.ip,
    handler: (_req, res) =>
      res.status(429).json({
        error: "Too many requests, please try again later.",
      }),
  });

  app.use("/api", apiLimiter);

  // Routes
  app.use("/api/products", productRoutes);
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
