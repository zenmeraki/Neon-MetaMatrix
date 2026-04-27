import express from "express";
import {
  getStoreAccess,
} from "../controllers/storeController.js";
import { validateBody } from "../middleware/validateQuery.js";
import { languageSchema } from "../validations/storeAccessSchema.js";

const router = express.Router();
router.get("/details", getStoreAccess);

export default router;
