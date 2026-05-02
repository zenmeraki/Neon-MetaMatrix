import express from "express";
import {
  clearCollections,
  getAllCollection,
} from "../controllers/collectionController.js";
import { CollectionService } from "../services/collectionService/CollectionService.js";
import shopify from "../shopify.js";

const collectionService = new CollectionService(shopify);

const router = express.Router();
router.get("/get-all", getAllCollection(collectionService));
router.get("/refresh", clearCollections(collectionService));
router.get("/collections-refresh", clearCollections(collectionService));

export default router;
