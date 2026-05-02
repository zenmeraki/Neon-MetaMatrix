// controllers/suggestionController.js

import { SuggestionService } from "../services/SuggestionService/SuggestionService.js";
import { logApiError } from "../utils/errorLogUtils.js";

const suggestionService = new SuggestionService();

export const addSuggestion = async (req, res) => {
  const { email, suggestion } = req.body;
  const session = res.locals.shopify?.session;

  // ✅ Validate input via Joi schema in SuggestionService
  const validationError = suggestionService.validate({ email, suggestion });

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    // ✅ This is now Prisma under the hood
    await suggestionService.saveSuggestion({ email, suggestion });

    // ✅ Notification email (unchanged, no DB)
    await suggestionService.sendEmailNotification({ email, suggestion });

    return res
      .status(201)
      .json({ message: "Suggestion submitted successfully!" });
  } catch (error) {
    // Guard session?.shop so it doesn’t crash if session is missing
    await logApiError({
      shop: session?.shop || null,
      err: error,
      req,
      source: "suggestionController.addSuggestion",
    });

    return res
      .status(500)
      .json({ message: "Server error. Please try again later." });
  }
};