import { prisma } from "../config/database.js";
import { operationService } from "./operationService.js";

export async function transitionOperation({
  shop,
  operationId,
  from,
  to,
  data = {},
  db = prisma,
}) {
  return operationService.transitionOperation(
    { shop, operationId, from, to, data },
    db,
  );
}
