import { productSavedSegmentRepository } from "../repositories/productSavedSegmentRepository.js";

export async function listProductSavedSegments(req, res) {
  const shop = res.locals.shopify.session.shop;
  const data = await productSavedSegmentRepository.list(shop);
  res.json({ success: true, data });
}

export async function saveProductSavedSegment(req, res) {
  const shop = res.locals.shopify.session.shop;
  const { name, filters, search, sort, destinations } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Name is required" });
  }

  const data = await productSavedSegmentRepository.upsert(shop, {
    name: name.trim(),
    filters: Array.isArray(filters) ? filters : [],
    search,
    sort,
    destinations,
  });

  res.json({ success: true, data });
}

export async function deleteProductSavedSegment(req, res) {
  const shop = res.locals.shopify.session.shop;
  await productSavedSegmentRepository.delete(shop, req.params.id);
  res.json({ success: true });
}
