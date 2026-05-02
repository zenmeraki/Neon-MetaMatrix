import Joi from "joi";

// Operators for numbers
const numberOps = Joi.string()
  .valid("<", ">", "!=", "+", "=", "<=", ">=")
  .allow("");

// Operators for dates
const dateOps = Joi.string()
  .valid("is before", "is after", "is after x days ago", "is before x days ago")
  .allow("");

// Operators for string fields
const stringOps = Joi.string()
  .valid(
    "equals",
    "does not equal",
    "contains",
    "does not contain",
    "contains any of the words",
    "starts with",
    "does not start with",
    "ends with",
    "is empty/blank",
    "equals (case insensitive)",
    "contains (case insensitive)"
  )
  .allow("");

// Validation schema for your filter config
const productQuerySchema = Joi.object({
  // Date fields
  created_at: Joi.string().allow(""),
  created_at_op: dateOps,
  created_at_days: Joi.string().allow(""),
  published_at: Joi.string().allow(""),
  published_at_op: dateOps,
  published_at_days: Joi.string().allow(""),
  updated_at: Joi.string().allow(""),
  updated_at_op: dateOps,
  updated_at_days: Joi.string().allow(""),

  // String fields
  collection_name: Joi.string().allow(""),
  collection_options: Joi.string().valid("is", "is not").allow(""),
  category: Joi.string().allow(""),
  category_option: Joi.string().valid("is", "is not").allow(""),
  status: Joi.string().valid("active", "draft", "archived").allow(""), // adjust if you have specific statuses

  product_type: Joi.string().allow(""),
  product_type_options: stringOps,

  product_id: Joi.string().allow(""),
  product_id_options: Joi.string().valid("is", "is not").allow(""),

  description: Joi.string().allow(""),
  description_op: stringOps,

  title: Joi.string().allow(""),
  title_op: stringOps,

  vendor: Joi.string().allow(""),
  vendor_op: stringOps,

  handle: Joi.string().allow(""),
  handle_op: stringOps,

  barcode: Joi.string().allow(""),
  barcode_op: stringOps,

  fulfillmentService: Joi.string().allow(""),
  fulfillmentService_op: stringOps,

  sku: Joi.string().allow(""),
  sku_op: stringOps,

  variant_title: Joi.string().allow(""),
  variant_title_op: stringOps,

  // Number fields
  vc: Joi.number().allow("", null).optional(),
  vc_op: numberOps.optional(),

  inventory_q: Joi.number().allow("", null).optional(),
  inventory_q_op: numberOps.optional(),

  price: Joi.number().allow("", null).optional(),
  price_op: numberOps.optional(),

  // Others
  search: Joi.string().allow(""),
  sortKey: Joi.string().allow(""),
  sortOrder: Joi.string().valid("asc", "desc").allow(""),
  page: Joi.string(),
  limit: Joi.string(),
});

export default productQuerySchema;
