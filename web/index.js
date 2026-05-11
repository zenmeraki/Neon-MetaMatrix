import { join } from "path";
import { readFileSync } from "fs";
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

// Shopify
import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";

// Routes
import productRoutes from "./routes/productRoutes.js";
import categorytRoutes from "./routes/categoryRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import SubscriptionRoutes from "./routes/subscriptionRoutes.js";
import SuggestionRoutes from "./routes/suggestionRoutes.js";
import HistoryRoutes from "./routes/historyRoutes.js";
import StoreRoutes from "./routes/storeRoutes.js";
import SyncRoutes from "./routes/syncRoutes.js";
import automaticProductRuleRoutes from "./routes/automaticProductRuleRoutes.js";
import productCodeSnippetRoutes from "./routes/productCodeSnippetRoutes.js";
import automationRoutes from "./routes/automationRoutes.js";
// import AffiliateRoutes from "./routes/affiliateRoutes.js";
import AdminRoutes from "./routes/adminRoutes.js";
import metricsRoute from "./routes/metricsRoute.js";

// DB + Redis
import prisma from "./config/database.js";
import { connection as redis } from "./config/redis.js";

// Socket
import { initSocket } from "./socket.js";
import {
  bootstrapBackgroundJobs,
  shutdownBackgroundJobs,
} from "./jobs/bootstrap.js";

// Utils / Middleware
import logger from "./utils/loggerUtils.js";
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
  process.env.SHOPIFY_API_KEY,
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
  }),
);

// Shopify CSP + CORS
app.use(shopify.cspHeaders());
app.use(cors());
app.set("trust proxy", 1);

/* ------------------------------------------------------------------ */
/*  HTTP + Socket                                                      */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

initSocket(io);

/* ------------------------------------------------------------------ */
/*  Redis                                                              */
/* ------------------------------------------------------------------ */

redis.on("ready", () => {
  console.log("Redis connected");
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

/* ------------------------------------------------------------------ */
/*  Shopify Auth & Webhooks                                            */
/* ------------------------------------------------------------------ */

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

app.use("/api/*", shopify.validateAuthenticatedSession());

/* ------------------------------------------------------------------ */
/*  Parsers & Compression                                              */
/* ------------------------------------------------------------------ */

app.use(express.json({ limit: "300kb" }));
app.use(compression({ threshold: 1024 }));

/* ------------------------------------------------------------------ */
/*  Rate Limiter                                                       */
/* ------------------------------------------------------------------ */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
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
app.use("/api/automations", automationRoutes);
app.use("/admin", AdminRoutes);
app.use("/metrics", metricsRoute);
// app.use("/referral", AffiliateRoutes);

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

/* ------------------------------------------------------------------ */
/*  Error Handler                                                      */
/* ------------------------------------------------------------------ */

app.use((err, req, res, _next) => {
  logger.error({
    err,
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

let isShuttingDown = false;

async function startServer() {
  await bootstrapBackgroundJobs();

  await new Promise((resolve, reject) => {
    server.listen(PORT, (error) => {
      if (error) {
        reject(error);
        return;
      }

      console.log(`Server ${process.pid} running at http://localhost:${PORT}`);
      resolve();
    });
  });
}

async function shutdownServer(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down`);

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  await shutdownBackgroundJobs();
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      await shutdownServer(signal);
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed", error);
      process.exit(1);
    }
  });
}

startServer().catch((err) => {
  console.error("Startup failed", err);
  process.exit(1);
});
