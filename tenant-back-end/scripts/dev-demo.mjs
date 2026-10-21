import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const backendRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(backendRoot, ".env.demo");
const allowedVariables = new Set([
  "HOST",
  "PORT",
  "DATABASE_FILE",
  "TENANT_API_KEYS",
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

const child = spawn(process.execPath, ["--watch", "src/server.mjs"], {
  cwd: backendRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Unable to start the demo tenant API:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
