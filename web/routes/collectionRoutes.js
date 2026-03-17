import express from "express";
import {
  clearCollections,
  getAllCollection,
  getCollectionsFromShopify,
} from "../controllers/collectionController.js";
import { CollectionService } from "../services/collectionService/CollectionService.js";
import shopify from "../shopify.js";

const collectionService = new CollectionService(shopify);

const router = express.Router();
router.get("/get-all", getCollectionsFromShopify);
router.get("/refresh", clearCollections(collectionService));
router.get("/collections-refresh", clearCollections(collectionService));

export default router;
