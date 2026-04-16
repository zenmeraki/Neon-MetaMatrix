import { prisma } from "../Config/database.js";

/**
 * FieldAuthorityRegistry repository.
 *
 * This is the Prisma-only boundary for a future persisted field registry.
 * The current codebase has a pure service registry, but no Prisma model yet.
 */

const DEFAULT_SELECT = {
  id: true,
  fieldKey: true,
  authorityDomain: true,
  status: true,
  sourceQuery: true,
  description: true,
  createdAt: true,
  updatedAt: true,
};

const assertFieldKey = (fieldKey) => {
  if (!fieldKey || typeof fieldKey !== "string") {
    throw new Error("fieldKey is required");
  }
};

const assertData = (data) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

const getFieldAuthorityRegistryDelegate = () => {
  if (!prisma.fieldAuthorityRegistry) {
    throw new Error(
      "Prisma model fieldAuthorityRegistry is not available. Add the FieldAuthorityRegistry model and regenerate Prisma Client before using this repository.",
    );
  }

  return prisma.fieldAuthorityRegistry;
};

export const findFieldAuthorityByFieldKey = async (fieldKey, options = {}) => {
  assertFieldKey(fieldKey);

  return getFieldAuthorityRegistryDelegate().findFirst({
    where: { fieldKey },
    orderBy: { updatedAt: "desc" },
    select: buildSelect(options.select),
  });
};

export const listFieldAuthorities = async (filters = {}, options = {}) => {
  const where = {
    ...(filters.authorityDomain
      ? { authorityDomain: filters.authorityDomain }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  return getFieldAuthorityRegistryDelegate().findMany({
    where,
    orderBy: [{ authorityDomain: "asc" }, { fieldKey: "asc" }],
    select: buildSelect(options.select),
  });
};

export const createFieldAuthority = async (data, options = {}) => {
  assertData(data);
  assertFieldKey(data.fieldKey);

  if (!data.authorityDomain) {
    throw new Error("authorityDomain is required");
  }

  return getFieldAuthorityRegistryDelegate().create({
    data,
    select: buildSelect(options.select),
  });
};

export const updateFieldAuthority = async (id, data, options = {}) => {
  if (!id || typeof id !== "string") {
    throw new Error("fieldAuthorityRegistry id is required");
  }

  assertData(data);

  return getFieldAuthorityRegistryDelegate().update({
    where: { id },
    data,
    select: buildSelect(options.select),
  });
};

export const deleteFieldAuthority = async (id) => {
  if (!id || typeof id !== "string") {
    throw new Error("fieldAuthorityRegistry id is required");
  }

  return getFieldAuthorityRegistryDelegate().delete({
    where: { id },
  });
};

