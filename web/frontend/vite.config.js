import { defineConfig } from "vite";
import { dirname } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

dotenv.config();

if (
  process.env.npm_lifecycle_event === "build" &&
  !process.env.CI &&
  !process.env.SHOPIFY_API_KEY
) {
  throw new Error(
    "\n\nThe frontend build will not work without an API key. Set the SHOPIFY_API_KEY environment variable when running the build command, for example:" +
      "\n\nSHOPIFY_API_KEY=<your-api-key> npm run build\n"
  );
}

process.env.VITE_SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

const proxyOptions = {
  target: `http://127.0.0.1:${process.env.BACKEND_PORT}`,
  changeOrigin: false,
  secure: true,
  ws: false,
};

const host = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: process.env.FRONTEND_PORT,
    clientPort: 443,
  };
}

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("node_modules")) return undefined;

          if (
            normalizedId.includes("/react/") ||
            normalizedId.includes("/react-dom/") ||
            normalizedId.includes("/scheduler/")
          ) {
            return "vendor-react";
          }

          if (
            normalizedId.includes("/react-router") ||
            normalizedId.includes("/history/")
          ) {
            return "vendor-router";
          }

          if (normalizedId.includes("/@shopify/polaris/")) {
            if (
              normalizedId.includes("/@shopify/polaris/build/esm/components/")
            ) {
              return "vendor-polaris-components";
            }

            if (
              normalizedId.includes("/@shopify/polaris/build/esm/utilities/")
            ) {
              return "vendor-polaris-utilities";
            }

            return "vendor-polaris";
          }

          if (
            normalizedId.includes("/@shopify/app-bridge") ||
            normalizedId.includes("/@shopify/i18next-shopify")
          ) {
            return "vendor-shopify";
          }

          if (
            normalizedId.includes("/i18next") ||
            normalizedId.includes("/react-i18next") ||
            normalizedId.includes("/@formatjs/")
          ) {
            return "vendor-i18n";
          }

          if (
            normalizedId.includes("/@reduxjs/") ||
            normalizedId.includes("/react-redux/") ||
            normalizedId.includes("/redux/")
          ) {
            return "vendor-state";
          }

          if (normalizedId.includes("/papaparse/")) {
            return "vendor-spreadsheet";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "localhost",
    port: process.env.FRONTEND_PORT,
    hmr: hmrConfig,
    allowedHosts: true,
    proxy: {
      "^/(\\?.*)?$": proxyOptions,
      "^/api(/|(\\?.*)?$)": proxyOptions,
    },
  },
});
