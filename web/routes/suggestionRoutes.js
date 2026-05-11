import express from 'express';
import { addSuggestion } from '../controllers/suggestionController.js';

const router = express.Router();
router.post('/submit', addSuggestion);

export default router;