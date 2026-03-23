// web/resync.js
import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "./generated/prisma/index.js";

const prisma = new PrismaClient();

const SHOP = "demo-zen-store.myshopify.com";
const PRODUCT_IDS = [
  "gid://shopify/Product/10262546317627",
  "gid://shopify/Product/10262508667195",
];

// Get access token directly from DB — no shopify.js needed
const sessionRow = await prisma.shopifySession.findFirst({
  where: { shop: SHOP, isOnline: false },
});

if (!sessionRow?.accessToken) {
  throw new Error("No offline session found for shop");
}

const ACCESS_TOKEN = sessionRow.accessToken;

for (const productId of PRODUCT_IDS) {
  const res = await fetch(`https://${SHOP}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query: `query getProduct($id: ID!) {
        product(id: $id) {
          id
          options { id name position values }
          variants(first: 250) {
            edges {
              node {
                id title sku barcode price compareAtPrice
                inventoryQuantity inventoryPolicy taxable position
                selectedOptions { name value }
              }
            }
          }
        }
      }`,
      variables: { id: productId },
    }),
  });

  const json = await res.json();
  const product = json.data.product;

  const variants = product.variants.edges.map(({ node }) => ({
    shop: SHOP,
    id: node.id,
    productId: product.id,
    title: node.title,
    sku: node.sku ?? null,
    barcode: node.barcode ?? null,
    price: node.price ? Number(node.price) : null,
    compareAtPrice: node.compareAtPrice ? Number(node.compareAtPrice) : null,
    inventoryQuantity: node.inventoryQuantity ?? null,
    inventoryPolicy: node.inventoryPolicy ?? null,
    taxable: node.taxable ?? null,
    position: node.position ?? null,
    selectedOptionsJson: node.selectedOptions,
    option1Value: node.selectedOptions?.[0]?.value ?? null,
    option2Value: node.selectedOptions?.[1]?.value ?? null,
    option3Value: node.selectedOptions?.[2]?.value ?? null,
  }));

  await prisma.variant.deleteMany({
    where: { shop: SHOP, productId: product.id },
  });

  await prisma.variant.createMany({ data: variants });

  const opts = product.options;
  await prisma.product.update({
    where: { shop_id: { shop: SHOP, id: product.id } },
    data: {
      option1Name: opts[0]?.name ?? null,
      option2Name: opts[1]?.name ?? null,
      option3Name: opts[2]?.name ?? null,
      variantCount: variants.length,
    },
  });

  console.log(`✅ Resynced ${product.id} — ${variants.length} variants restored`);
}

await prisma.$disconnect();