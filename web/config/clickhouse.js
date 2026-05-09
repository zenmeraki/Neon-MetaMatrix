import { createClient } from "@clickhouse/client";

let clickhouseClientInstance = null;

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for ClickHouse execution`);
  }

  return value;
}

export function isClickHouseConfigured() {
  return Boolean(
    process.env.CLICKHOUSE_HOST &&
      process.env.CLICKHOUSE_USER &&
      process.env.CLICKHOUSE_PASSWORD,
  );
}

export function getClickHouseClient() {
  if (clickhouseClientInstance) {
    return clickhouseClientInstance;
  }

  clickhouseClientInstance = createClient({
    host: requireEnv("CLICKHOUSE_HOST"),
    username: requireEnv("CLICKHOUSE_USER"),
    password: requireEnv("CLICKHOUSE_PASSWORD"),
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });

  return clickhouseClientInstance;
}
