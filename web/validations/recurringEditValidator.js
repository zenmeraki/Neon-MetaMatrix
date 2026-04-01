import Joi from "joi";

export const recurringEditSchema = Joi.object({
  title: Joi.string().required(),

  frequency: Joi.string()
    .valid("Daily", "Weekly", "Monthly", "Hourly", "Every 2 Hours")
    .required(),

  timeToRun: Joi.when("frequency", {
    is: Joi.valid("Daily", "Weekly", "Monthly"),
    then: Joi.string()
      .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .required(),
    otherwise: Joi.forbidden(),
  }),

  dayOfMonthToRun: Joi.when("frequency", {
    is: "Monthly",
    then: Joi.number().min(1).max(31).required(),
    otherwise: Joi.forbidden(),
  }),

  daysOfWeekToRun: Joi.when("frequency", {
    is: "Weekly",
    then: Joi.array()
      .items(
        Joi.string().valid(
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday"
        )
      )
      .min(1)
      .required(),
    otherwise: Joi.forbidden(),
  }),

  timezone: Joi.string().default("UTC"),

  filterParams: Joi.object().required(),

  steps: Joi.array()
    .items(
      Joi.object({
        field: Joi.string().trim().max(100).required(),
        value: Joi.any().required(),
        editType: Joi.string().required(),
      })
    )
    .min(1)
    .required(),

  status: Joi.string().valid("Active", "Inactive").default("Active"),
});

