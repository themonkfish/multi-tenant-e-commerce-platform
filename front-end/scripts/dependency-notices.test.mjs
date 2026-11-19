import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateDependencyNotices } from "./dependency-notices.mjs";

test("generates a sorted dependency notice manifest", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "dependency-notices-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "package-lock.json");
  const outputPath = join(directory, "dependency-notices.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "root", version: "1.0.0" },
        "node_modules/zod": {
          version: "4.0.0",
          license: "MIT",
          resolved: "https://registry.npmjs.org/zod/-/zod-4.0.0.tgz",
          integrity: "sha512-test",
        },
        "node_modules/@node-rs/argon2": {
          version: "2.0.0",
          license: "MIT",
        },
      },
    }),
    "utf8",
  );

  const manifest = await generateDependencyNotices({
    packageLockPath: lockPath,
    outputPath,
  });
  assert.equal(manifest.packageCount, 2);
  assert.deepEqual(
    manifest.packages.map((pkg) => `${pkg.name}@${pkg.version}`),
    ["@node-rs/argon2@2.0.0", "zod@4.0.0"],
  );
  assert.equal(manifest.packages[0].license, "MIT");
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).packageCount, 2);
});
