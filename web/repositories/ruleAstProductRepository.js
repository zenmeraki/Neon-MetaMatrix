import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import {
  buildFreezeTargetSetQuery,
  buildProductCountQuery,
  buildProductSearchQuery,
} from "../services/rules/astSqlCompiler.js";

function getClient(db) {
  return db || prisma;
}

function assertCompiledQuery(compiled, operationName) {
  if (!compiled || typeof compiled.sql !== "string" || !Array.isArray(compiled.params)) {
    throw new Error(`${operationName} returned invalid compiled SQL`);
  }

  const sql = compiled.sql.trim();

  if (!sql) {
    throw new Error(`${operationName} returned empty SQL`);
  }

  const normalized = sql.toLowerCase();

  if (
    normalized.includes(";") ||
    normalized.includes("--") ||
    normalized.includes("/*") ||
    normalized.includes("*/")
  ) {
    throw new Error(`${operationName} returned unsafe SQL tokens`);
  }

  return {
    sql,
    params: compiled.params,
  };
}

function toPrismaRaw(sql, params) {
  return Prisma.sql([sql], ...params);
}

export async function searchProductsByAst(args, db = prisma) {
  const compiled = assertCompiledQuery(
    buildProductSearchQuery(args),
    "buildProductSearchQuery",
  );

  return getClient(db).$queryRaw(toPrismaRaw(compiled.sql, compiled.params));
}

export async function countProductsByAst(args, db = prisma) {
  const compiled = assertCompiledQuery(
    buildProductCountQuery(args),
    "buildProductCountQuery",
  );

  const rows = await getClient(db).$queryRaw(toPrismaRaw(compiled.sql, compiled.params));

  const rawCount = rows?.[0]?.count;
  return typeof rawCount === "bigint" ? Number(rawCount) : Number(rawCount || 0);
}

export async function freezeTargetSetByAst(args, db = prisma) {
  const compiled = assertCompiledQuery(
    buildFreezeTargetSetQuery(args),
    "buildFreezeTargetSetQuery",
  );

  return getClient(db).$executeRaw(toPrismaRaw(compiled.sql, compiled.params));
}

export const ruleAstProductRepository = {
  searchProductsByAst,
  countProductsByAst,
  freezeTargetSetByAst,
};
