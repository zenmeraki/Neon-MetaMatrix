import { join } from "path";
import { readFileSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import compression from "compression";
import serveStatic from "serve-static";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

// Shopify
import shopify from "./shopify.js";
import ShopifyWebhookHandlers from "./webhooks/shopifyWebhookHandlers.js";

// Routes
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
import performanceRoutes from "./routes/performanceRoutes.js";
import compatRoutes from "./routes/compatRoutes.js";
// import AffiliateRoutes from "./routes/affiliateRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";

// DB + Redis
import prisma from "./Config/database.js";
import { connection as redis } from "./Config/redis.js";

// Socket
import { initSocket } from "./socket.js";

// Utils / Middleware
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

/* ------------------------------------------------------------------ */

const PORT = parseInt(process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const rawIndex = readFileSync(join(STATIC_PATH, "index.html"), "utf-8");
const indexHTML = rawIndex.replace(
  "%VITE_SHOPIFY_API_KEY%",
  process.env.SHOPIFY_API_KEY
);
/* ------------------------------------------------------------------ */
/*  Express App                                                        */
/* ------------------------------------------------------------------ */

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// Shopify CSP + CORS
app.use(shopify.cspHeaders());
app.use(cors(buildCorsOptions()));
app.set("trust proxy", 1);
app.use(requestContextMiddleware);

/* ------------------------------------------------------------------ */
/*  HTTP + Socket                                                      */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const io = new Server(server, {
  cors: buildCorsOptions(),
});

initSocket(io);

/* ------------------------------------------------------------------ */
/*  Redis                                                              */
/* ------------------------------------------------------------------ */

redis.on("ready", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

/* ------------------------------------------------------------------ */
app.get("/healthz", (_req, res) => {
  res.status(200).json({
    service: "api",
    status: "ok",
    pid: process.pid,
  });
});

/*  Shopify Auth & Webhooks                                            */
/* ------------------------------------------------------------------ */

app.get(shopify.config.auth.path, shopPreInstallation, shopify.auth.begin());

app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  appInstallMiddleware,
  shopify.redirectToShopifyOrAppRoot()
);

app.post(
  shopify.config.webhooks.path,
  webhookLimiter,
  logWebhookIngress,
  express.raw({
    type: "application/json",
    limit: getWebhookRawBodyLimit(),
  }),
  shopify.processWebhooks({ webhookHandlers: ShopifyWebhookHandlers })
);

/* ------------------------------------------------------------------ */
/*  Parsers & Compression                                              */
/* ------------------------------------------------------------------ */

app.use(express.json({ limit: "300kb" }));
app.use(compression({ threshold: 1024 }));

/* ------------------------------------------------------------------ */
/*  Rate Limiter                                                       */
/* ------------------------------------------------------------------ */

app.use("/api", apiLimiter);
const userSessionAuth = shopify.validateAuthenticatedSession();
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
// app.use("/referral", AffiliateRoutes);


app.use(
  serveStatic(STATIC_PATH, {
    index: false,
    maxAge: process.env.NODE_ENV === "production" ? "30d" : "0",
    immutable: false,
  })
);

app.get("/*", shopify.ensureInstalledOnShop(), (_req, res) => {
  res.status(200).type("html").send(indexHTML);
});

/* ------------------------------------------------------------------ */
/*  Error Handler                                                      */
/* ------------------------------------------------------------------ */

app.use((err, req, res, _next) => {
  logger.error({
    err,
    requestId: res.getHeader("x-request-id"),
    path: req.path,
    shop: res.locals.shopify?.session?.shop,
  });

  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

/* ------------------------------------------------------------------ */
/*  Start Server                                                       */
/* ------------------------------------------------------------------ */

server.listen(PORT, () => {
  (async () => {
    try {

      console.log(
        `🚀 Worker ${process.pid} running at http://localhost:${PORT}`
      );

    } catch (err) {
      console.error("Startup failed", err);
      process.exit(1);
    }
  })();
});

let shutdownStarted = false;
async function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  logger.info("API shutdown started", { signal });
  server.close(async () => {
    try {
      await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
      logger.info("API shutdown completed", { signal });
      process.exit(0);
    } catch (error) {
      logger.error("API shutdown failed", {
        signal,
        message: error.message,
      });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("API shutdown timed out", { signal });
    process.exit(1);
  }, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 30_000)).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
