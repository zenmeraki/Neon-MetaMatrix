import Joi from "joi";
import mongoose from "mongoose";

const objectIdValidator = (value, helpers) => {
  if (!value) return value; // allow undefined/null
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.message("Cursor must be a valid ObjectId");
  }
  return value;
};

const editHistoryQuerySchema = Joi.object({
  type: Joi.string()
    .valid("Manual edit", "Scheduled edit", "Reccuring edit", "Favorites")
    .optional(),

  search: Joi.string().optional(),

  cursor: Joi.string().optional(),
  lang: Joi.string().optional(),

  limit: Joi.number().integer().min(1).max(100).optional(),
});

export default editHistoryQuerySchema;
