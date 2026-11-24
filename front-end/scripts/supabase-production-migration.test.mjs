import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSupabaseDbPushArgs,
  preflightSupabaseMigrations,
  runSupabaseDbPush,
} from "./supabase-production-migration.mjs";

test("preflights ordered migration filenames", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "supabase-migrations-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "supabase", "migrations"), { recursive: true });
  const migrationsDirectory = join(directory, "supabase", "migrations");
  await writeFile(join(migrationsDirectory, "0002_next.sql"), "select 2;");
  await writeFile(join(migrationsDirectory, "0001_initial.sql"), "select 1;");

  const names = await preflightSupabaseMigrations({ migrationsDirectory });
  assert.deepEqual(names, ["0001_initial.sql", "0002_next.sql"]);
});

test("rejects invalid migration filenames", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "supabase-migrations-invalid-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "supabase", "migrations"), { recursive: true });
  const migrationsDirectory = join(directory, "supabase", "migrations");
  await writeFile(join(migrationsDirectory, "README.sql"), "not a migration");

  await assert.rejects(
    preflightSupabaseMigrations({ migrationsDirectory }),
    /Invalid migration filename/,
  );
});

test("builds dry-run and apply database push arguments", () => {
  assert.deepEqual(
    buildSupabaseDbPushArgs({ dbUrl: "postgres://example/db", dryRun: true }),
    ["db", "push", "--db-url", "postgres://example/db", "--dry-run"],
  );
  assert.deepEqual(
    buildSupabaseDbPushArgs({ dbUrl: "postgres://example/db" }),
    ["db", "push", "--db-url", "postgres://example/db"],
  );
  assert.throws(
    () => buildSupabaseDbPushArgs({ dbUrl: "" }),
    /SUPABASE_DB_URL is required/,
  );
});

test("reports failed Supabase migration pushes", () => {
  assert.throws(
    () =>
      runSupabaseDbPush({
        dbUrl: "postgres://example/db",
        spawn: () => ({
          status: 1,
          stdout: "",
          stderr: "migration failed",
        }),
      }),
    /migration failed/,
  );
});
