import express from "express";
import { createSubscriptionController, getPlansController } from "../controllers/subscriptionController.js";

const router = express.Router();
router.get("/get-plans",getPlansController)
router.post("/create-subscription", createSubscriptionController);
export default router;