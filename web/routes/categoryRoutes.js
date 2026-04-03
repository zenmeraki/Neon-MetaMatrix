import express from "express";
import { getAllCategories } from "../controllers/categoryController.js";

const router = express.Router();

// Dashboard
router.get("/get-all", getAllCategories);

export default router;
