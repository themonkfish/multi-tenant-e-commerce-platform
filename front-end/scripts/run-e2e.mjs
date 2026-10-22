import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const frontendRoot = resolve(import.meta.dirname, "..");
const fixtureRoot = await mkdtemp(resolve(tmpdir(), "tenant-orders-e2e-"));
const playwrightCli = resolve(
  frontendRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const child = spawn(process.execPath, [playwrightCli, "test"], {
  cwd: frontendRoot,
  env: { ...process.env, E2E_FIXTURE_DIR: fixtureRoot },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

try {
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
  process.exitCode = exitCode;
} finally {
  await rm(fixtureRoot, { recursive: true, force: false });
}
