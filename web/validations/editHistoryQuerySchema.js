import Joi from "joi";

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