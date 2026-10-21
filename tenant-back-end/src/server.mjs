import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { createTenantApiServer } from "./app.mjs";
import { createProductRepository } from "./repository-factory.mjs";

export async function startServer(env = process.env) {
  const config = loadConfig(env);
  const repository = await createProductRepository(config);
  const server = createTenantApiServer({
    tenantApiKeys: config.tenantApiKeys,
    repository,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  console.info(
    `Tenant REST API listening on ${config.host}:${config.port} (${config.databaseProvider})`,
  );

  const shutdown = () => {
    server.close(() => {
      repository.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, repository };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
