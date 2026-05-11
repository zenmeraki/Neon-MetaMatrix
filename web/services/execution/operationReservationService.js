import { prisma } from "../../config/database.js";

function buildConflictError(code, message, details = null) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 409;
  error.details = details;
  return error;
}

export const operationReservationService = {
  async reserve({ shop, pipeline, operationId, status = "QUEUED" }) {
    try {
      const lease = await prisma.operationLease.create({
        data: {
          shop,
          pipeline,
          operationId,
          status,
        },
      });
      return { reserved: true, lease };
    } catch (error) {
      if (error?.code === "P2002") {
        throw buildConflictError(
          "OPERATION_ALREADY_RESERVED",
          "Operation is already reserved for this pipeline",
          { shop, pipeline, operationId },
        );
      }
      throw error;
    }
  },

  async release({ shop, pipeline, operationId }) {
    await prisma.operationLease.deleteMany({
      where: {
        shop,
        pipeline,
        operationId,
      },
    });
  },
};
