import Joi from "joi";
import { fieldMappings } from "../modules/productExports/productExportUtils.js";

export const productExportSchema = Joi.object({
  columns: Joi.array()
    .items(Joi.string().valid(...Object.keys(fieldMappings)))
    .required(),
  filterParams: Joi.array().required(),
  filename: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+\.csv$/)
    .required(),
});
