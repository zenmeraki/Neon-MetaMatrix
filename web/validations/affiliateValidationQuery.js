import Joi from "joi";

export const affiliateUserValidationSchema = Joi.object({
  name: Joi.string().required().messages({
    "string.base": "Name must be a string",
    "any.required": "Name is required",
  }),

  email: Joi.string().email().required().messages({
    "string.email": "Email must be a valid email",
    "any.required": "Email is required",
  }),

  phone: Joi.string().min(10).messages({
    "string.min": "Phone Number must be 10 characters",
  }),
});

