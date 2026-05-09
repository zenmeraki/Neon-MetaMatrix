// services/suggestionService.js
import Joi from "joi";
import nodemailer from "nodemailer";
import { sendEmail } from "../../utils/emailHelper.js";

import { prisma } from "../../config/database.js";

export class SuggestionService {
  constructor() {
    this.suggestionSchema = Joi.object({
      email: Joi.string().email().required().messages({
        "string.email": "Invalid email format.",
        "string.empty": "Email is required.",
      }),
      suggestion: Joi.string().min(10).required().messages({
        "string.min": "Suggestion must be at least 10 characters long.",
        "string.empty": "Suggestion is required.",
      }),
    });
  }

  validate(data) {
    const { error } = this.suggestionSchema.validate(data, {
      abortEarly: true,
    });
 if (error) {
      return error.details[0].message;
    }

    return null;
  }  

  async saveSuggestion({ email, suggestion }) {
    try {
  const result = await prisma.suggestion.create({
        data: {
          email,
          suggestion,
        },
      });
            return result;
    } catch (err) {
      console.error("Error saving suggestion to database", { error: err.message, email });
      throw new Error("Database save failed.");
    }
  }

  async sendEmailNotification({ email, suggestion }) {
    try {
      await sendEmail(
        "zenmerakihelp@gmail.com",
        "New Suggestion Received",
        `You have a new suggestion:\n\nEmail: ${email}\nSuggestion: ${suggestion}`
      );
    } catch (error) {
      console.error("Failed to send suggestion notification email", { error: error.message, email });
      throw new Error("Email sending failed.");
    }
  }
}
