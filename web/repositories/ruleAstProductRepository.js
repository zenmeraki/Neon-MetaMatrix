import { prisma } from "../config/database.js";
import {
  buildFreezeTargetSetQuery,
  buildProductCountQuery,
  buildProductSearchQuery,
} from "../services/rules/astSqlCompiler.js";

function getClient(db) {
  return db || prisma;
}

export async function searchProductsByAst(args, db = prisma) {
  const { sql, params } = buildProductSearchQuery(args);

  return getClient(db).$queryRawUnsafe(sql, ...params);
}

export async function countProductsByAst(args, db = prisma) {
  const { sql, params } = buildProductCountQuery(args);

  const rows = await getClient(db).$queryRawUnsafe(sql, ...params);
  return rows[0]?.count ?? 0;
}

export async function freezeTargetSetByAst(args, db = prisma) {
  const { sql, params } = buildFreezeTargetSetQuery(args);

  return getClient(db).$executeRawUnsafe(sql, ...params);
}

export const ruleAstProductRepository = {
  searchProductsByAst,
  countProductsByAst,
  freezeTargetSetByAst,
};
