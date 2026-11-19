import { readFile, writeFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { pathToFileURL } from "node:url";

function normalizePackageName(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index >= 0 ? packagePath.slice(index + marker.length) : packagePath;
}

export async function generateDependencyNotices({
  packageLockPath,
  outputPath,
}) {
  const lock = JSON.parse(await readFile(resolve(packageLockPath), "utf8"));
  const packages = Object.entries(lock.packages ?? {})
    .filter(([packagePath, record]) => packagePath && record?.version)
    .map(([packagePath, record]) => ({
      name: normalizePackageName(packagePath),
      version: record.version,
      license: record.license ?? "UNKNOWN",
      resolved:
        typeof record.resolved === "string" ? record.resolved : undefined,
      integrity:
        typeof record.integrity === "string" ? record.integrity : undefined,
    }))
    .sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(
        `${right.name}@${right.version}`,
      ),
    );

  const manifest = {
    generatedAt: new Date().toISOString(),
    packageManager: "npm",
    packageCount: packages.length,
    packages,
  };
  await writeFile(
    resolve(outputPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(normalize(resolve(process.argv[1]))).href
) {
  const packageLockPath =
    process.argv[2] ?? resolve(import.meta.dirname, "..", "package-lock.json");
  const outputPath =
    process.argv[3] ??
    resolve(import.meta.dirname, "..", "dependency-notices.json");
  await generateDependencyNotices({ packageLockPath, outputPath });
}
