// scripts/clearShopLock.js
import { connection } from "../web/Config/redis.js";

const shop = "demo-zen-store.myshopify.com";

// Scan for all keys related to this shop
const keys = await connection.keys(`*${shop}*`);
console.log("Keys found:", keys);

process.exit(0);