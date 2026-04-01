import express from 'express';
import rateLimit from "express-rate-limit";
import { addSuggestion } from '../controllers/suggestionController.js';

const router = express.Router();
const suggestionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many requests" }),
});

router.post('/submit', suggestionLimiter, addSuggestion);

export default router;
