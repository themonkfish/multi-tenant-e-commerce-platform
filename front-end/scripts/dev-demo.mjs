import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const frontendRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(frontendRoot, ".env.demo");
const allowedVariables = new Set([
  "NODE_ENV",
  "PLATFORM_STORE",
  "PLATFORM_STORE_FILE",
  "PLATFORM_SECRET_KEY",
  "SESSION_SECRET",
  "NEXT_PUBLIC_PLATFORM_DOMAIN",
  "TENANT_REST_ALLOW_LOCAL_HTTP",
]);
const envLines = await readFile(envFile, "utf8");

for (const [index, line] of envLines.split(/\r?\n/).entries()) {
  if (!line) continue;
  const separator = line.indexOf("=");
  const name = line.slice(0, separator);
  if (separator <= 0 || !allowedVariables.has(name)) {
    throw new Error(`Invalid demo environment entry on line ${index + 1}`);
  }
  process.env[name] = line.slice(separator + 1);
}

process.env.NEXT_DIST_DIR = ".next-demo";
const nextCli = resolve(
  frontendRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const child = spawn(process.execPath, [nextCli, "dev"], {
  cwd: frontendRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Unable to start the demo website:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
