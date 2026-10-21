import { resolve } from "node:path";

function parseTenantApiKeys(env) {
  if (env.TENANT_API_KEYS) {
    let parsed;
    try {
      parsed = JSON.parse(env.TENANT_API_KEYS);
    } catch {
      throw new Error("TENANT_API_KEYS must be a valid JSON object");
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("TENANT_API_KEYS must map tenant IDs to API keys");
    }

    const entries = Object.entries(parsed);
    if (
      entries.length === 0 ||
      entries.some(
        ([tenantId, apiKey]) =>
          tenantId.length === 0 ||
          tenantId.length > 128 ||
          typeof apiKey !== "string" ||
          apiKey.length < 16,
      )
    ) {
      throw new Error(
        "TENANT_API_KEYS must contain tenant IDs and API keys of at least 16 characters",
      );
    }
    return new Map(entries);
  }

  if (
    !env.DEFAULT_TENANT_ID ||
    env.DEFAULT_TENANT_ID.length > 128 ||
    !env.TENANT_API_KEY ||
    env.TENANT_API_KEY.length < 16
  ) {
    throw new Error(
      "Configure TENANT_API_KEYS or both DEFAULT_TENANT_ID and a TENANT_API_KEY of at least 16 characters",
    );
  }
  return new Map([[env.DEFAULT_TENANT_ID, env.TENANT_API_KEY]]);
}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? "4100");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const host = env.HOST ?? "127.0.0.1";
  if (host.trim().length === 0) {
    throw new Error("HOST must be a non-empty bind address");
  }

  const databaseProvider = env.DATABASE_PROVIDER ?? "sqlite";
  if (databaseProvider !== "sqlite") {
    throw new Error(
      `Unsupported DATABASE_PROVIDER "${databaseProvider}". The SQLite adapter is currently implemented.`,
    );
  }

  const databaseFile = env.DATABASE_FILE ?? "./data/tenant-backend.sqlite";
  if (databaseFile.trim().length === 0) {
    throw new Error("DATABASE_FILE must be a non-empty path");
  }

  return {
    port,
    host,
    databaseProvider,
    databaseFile:
      databaseFile === ":memory:" ? databaseFile : resolve(databaseFile),
    tenantApiKeys: parseTenantApiKeys(env),
  };
}
