import express from "express";
import { metricsEndpoint } from "../utils/metricsUtils.js";

const router = express.Router();

router.get("/", metricsEndpoint);

export default router;
