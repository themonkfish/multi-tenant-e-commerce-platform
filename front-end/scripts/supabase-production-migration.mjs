import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function preflightSupabaseMigrations({
  migrationsDirectory = resolve(process.cwd(), "supabase", "migrations"),
} = {}) {
  const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) {
    throw new Error("No Supabase migration SQL files found");
  }
  for (let index = 1; index < names.length; index += 1) {
    if (names[index - 1].localeCompare(names[index]) >= 0) {
      throw new Error(
        `Migration files are not in deterministic name order: ${names[index - 1]}, ${names[index]}`,
      );
    }
  }
  for (const name of names) {
    if (!/^(\d{4})_.+\.sql$/.test(name)) {
      throw new Error(`Invalid migration filename: ${name}`);
    }
  }
  return names;
}

export function buildSupabaseDbPushArgs({ dbUrl, dryRun = false }) {
  if (!dbUrl?.trim()) {
    throw new Error("SUPABASE_DB_URL is required");
  }
  return [
    "db",
    "push",
    "--db-url",
    dbUrl.trim(),
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

export function runSupabaseDbPush({
  dbUrl,
  dryRun = false,
  supabaseExecutable = "supabase",
  env = process.env,
  spawn = spawnSync,
}) {
  const args = buildSupabaseDbPushArgs({ dbUrl, dryRun });
  const result = spawn(supabaseExecutable, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Supabase migration ${dryRun ? "dry-run " : ""}failed${details ? `:\n${details}` : ""}`,
    );
  }
  return { dryRun, migrationsApplied: !dryRun };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/supabase-production-migration.mjs preflight",
    "  node scripts/supabase-production-migration.mjs deploy [--dry-run]",
  ].join("\n");
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const positional = process.argv.slice(2);
  const command = positional[0];
  const dryRun = positional.includes("--dry-run");
  try {
    if (command === "preflight") {
      const migrations = await preflightSupabaseMigrations();
      console.log(JSON.stringify({ migrations: migrations.length, names: migrations }, null, 2));
    } else if (command === "deploy") {
      if (process.env.MIGRATION_DEPLOY_CONFIRM !== "APPLY" && !dryRun) {
        throw new Error("Set MIGRATION_DEPLOY_CONFIRM=APPLY to deploy migrations");
      }
      await preflightSupabaseMigrations();
      const result = runSupabaseDbPush({
        dbUrl: process.env.SUPABASE_DB_URL,
        dryRun,
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error(usage());
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
