import Joi from "joi";

const supportedLanguages = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "ar",
  "hi",
  "zh",
  "ja",
  "ko",
  "ru",
];

export const languageSchema = Joi.object({
  language: Joi.string()
    .valid(...supportedLanguages)
    .required()
    .messages({
      "string.base": "Language must be a string",
      "any.required": "Language is required",
      "any.only": `Language must be one of: ${supportedLanguages.join(", ")}`,
    }),
});
