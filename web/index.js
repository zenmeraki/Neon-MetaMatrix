import { join } from "path";
import { readFileSync } from "fs";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import serveStatic from "serve-static";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";

import productRoutes from "./routes/productRoutes.js";
import categorytRoutes from "./routes/categoryRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import SubscriptionRoutes from "./routes/SubscriptionRoutes.js";
import SuggestionRoutes from "./routes/SuggestionRoutes.js";
import HistoryRoutes from "./routes/HistoryRoutes.js";
import StoreRoutes from "./routes/storeRoutes.js";
import SyncRoutes from "./routes/syncRoutes.js";
import automaticProductRuleRoutes from "./routes/automaticProductRuleRoutes.js";
import productCodeSnippetRoutes from "./routes/productCodeSnippetRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";

import prisma from "./config/database.js";
import { connection as redis } from "./Config/redis.js";

import { initSocket } from "./socket.js";

import "./Jobs/Workers/bulkEditWorker.js";
import "./Jobs/Workers/bulkExportWorker.js";
import "./Jobs/Workers/bulkUndoWorker.js";
import "./Jobs/Workers/bulkOperationMutationWorker.js";
import "./Jobs/Workers/bulkOperationQueryWorker.js";
import "./Jobs/Workers/appInstallationWorker.js";
import "./Jobs/Workers/scheduledEditWorker.js";
import "./Jobs/Workers/appUninstallWorker.js";
import "./Jobs/Workers/bulkImportEditWorker.js";
import "./Jobs/Workers/shopSyncWorker.js";
import "./workers/recurringEditExecutionWorker.js";
import "./workers/recurringEditSchedulerWorker.js";
import "./workers/scheduledExportExecutionWorker.js";
import "./workers/scheduledExportSchedulerWorker.js";
import "./workers/automaticProductRuleExecutionWorker.js";
import "./workers/automaticProductRuleSchedulerWorker.js";
import "./workers/automaticProductRuleSignalWorker.js";

import logger from "./utils/loggerUtils.js";
import {
  appInstallMiddleware,
  shopPreInstallation,
} from "./middleware/appInstallMiddleware.js";
import { requireAdminAccess } from "./middleware/adminAccessMiddleware.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const rawIndex = readFileSync(join(STATIC_PATH, "index.html"), "utf-8");
const indexHTML = rawIndex.replace(
  "%VITE_SHOPIFY_API_KEY%",
  process.env.SHOPIFY_API_KEY || "",
);

function addOriginFromEnv(originSet, value) {
  if (!value) {
    return;
  }

  try {
    const normalized =
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`;
    originSet.add(new URL(normalized).origin);
  } catch {
    logger.warn("Ignoring invalid origin value", { value });
  }
}

function buildAllowedOrigins() {
  const origins = new Set(["https://admin.shopify.com"]);
  addOriginFromEnv(origins, process.env.SHOPIFY_APP_URL);
  addOriginFromEnv(origins, process.env.HOST);
  addOriginFromEnv(origins, process.env.APP_URL);
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

app.use(shopify.cspHeaders());
app.use(cors(corsOptions));
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

initSocket(io);

redis.on("ready", () => {
  logger.info("Redis connected");
});

redis.on("error", (err) => {
  logger.error("Redis error", {
    message: err.message,
  });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

const opsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(shopify.config.auth.path, authLimiter);
app.use(shopify.config.auth.callbackPath, authLimiter);

app.get(shopify.config.auth.path, shopPreInstallation, shopify.auth.begin());

app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  appInstallMiddleware,
  shopify.redirectToShopifyOrAppRoot(),
);

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers }),
);

app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: true, limit: "300kb" }));
app.use(compression({ threshold: 1024 }));

app.use("/api", apiLimiter, shopify.validateAuthenticatedSession());

app.use("/api/products", productRoutes);
app.use("/api/category", categorytRoutes);
app.use("/api/collection", collectionRoutes);
app.use("/api/suggestion", SuggestionRoutes);
app.use("/api/subscription", SubscriptionRoutes);
app.use("/api/history", HistoryRoutes);
app.use("/api/store", StoreRoutes);
app.use("/api/sync", SyncRoutes);
app.use("/api/automatic-rules", automaticProductRuleRoutes);
app.use("/api/product-code-snippets", productCodeSnippetRoutes);
app.use(
  "/admin",
  opsLimiter,
  shopify.validateAuthenticatedSession(),
  requireAdminAccess,
  AdminRoutes,
);
app.use(
  "/metrics",
  opsLimiter,
  shopify.validateAuthenticatedSession(),
  requireAdminAccess,
  metricsRoute,
);

app.use(
  serveStatic(STATIC_PATH, {
    index: false,
    maxAge: "1y",
    immutable: true,
  }),
);

app.get("/*", shopify.ensureInstalledOnShop(), (_req, res) => {
  res.status(200).type("html").send(indexHTML);
});

app.use((err, req, res, _next) => {
  logger.error("Unhandled application error", {
    requestId: req.requestId || null,
    path: req.path,
    shop: res.locals.shopify?.session?.shop || null,
    message: err?.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
  });

  res.status(err?.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err?.message || "Internal Server Error",
    requestId: req.requestId || null,
  });
});

server.listen(PORT, async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Server started", {
      pid: process.pid,
      port: PORT,
    });
  } catch (err) {
    logger.error("Startup dependency check failed", {
      message: err.message,
    });
    process.exit(1);
  }
});
