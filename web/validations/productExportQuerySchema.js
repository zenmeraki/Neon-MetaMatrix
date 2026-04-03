import Joi from "joi";
import { fieldMappings } from "../utils/productExportUtils.js";

export const productExportSchema = Joi.object({
  fields: Joi.array()
    .items(Joi.string().valid(...Object.keys(fieldMappings)))
    .optional(),
  columns: Joi.array()
    .items(Joi.string().valid(...Object.keys(fieldMappings)))
    .optional(),
  filterParams: Joi.array().items(Joi.object()).required(),
  fileName: Joi.string().trim().min(1).optional(),
  filename: Joi.string()
    .trim()
    .min(1)
    .optional(),
})
  .or("fields", "columns")
  .or("fileName", "filename");
