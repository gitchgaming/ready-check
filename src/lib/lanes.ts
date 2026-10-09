import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

// Staging runs one Railway service in two lanes. The main lane is Railway's
// GitHub deploy of `main` and uses the staging database. The branch lane is a
// `railway up` of any working tree (`npm run deploy:branch`) and uses a
// throwaway copy of it, so branch migrations never touch the staging database.
// Only one lane runs at a time: a service has one active deployment.
// Lanes apply only where DEPLOY_LANES=1 (staging); production ignores them.

/** Written by `deploy:branch` into the uploaded tree; its presence marks a branch deploy. */
export type DeployInfo = { branch: string; commit: string; dirty: boolean; deployedAt: string };

export const DEPLOY_INFO_FILE = "deploy-info.json";
/** Where the Docker image keeps the marker (see Dockerfile). */
export const DEPLOY_INFO_PATH = join("deploy", DEPLOY_INFO_FILE);

export type Lane = "main" | "branch";

export function lanesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEPLOY_LANES === "1";
}

export function readDeployInfo(path = DEPLOY_INFO_PATH): DeployInfo | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DeployInfo;
}

/**
 * The main lane needs positive proof: a GitHub deploy of `main` with no branch
 * marker. Anything else runs on the copy, so a misdetection can only cost
 * test data, never the staging database.
 */
export function chooseLane(env: NodeJS.ProcessEnv, info: DeployInfo | null): Lane {
  return !info && env.RAILWAY_GIT_BRANCH === "main" ? "main" : "branch";
}

/** Short label for logs and the bot's status, e.g. "main @ 1a2b3c4" or "my-branch @ 1a2b3c4*". */
export function deployLabel(env: NodeJS.ProcessEnv, info: DeployInfo | null): string {
  if (info) return `${info.branch} @ ${info.commit.slice(0, 7)}${info.dirty ? "*" : ""}`;
  const sha = env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown";
  return `${env.RAILWAY_GIT_BRANCH ?? "unknown branch"} @ ${sha}`;
}

export function sqlitePath(url: string): string {
  if (!url.startsWith("file:")) throw new Error(`DATABASE_URL must be a file: URL, got "${url}"`);
  return url.slice("file:".length);
}

export function branchDbPath(stagingPath: string): string {
  return join(stagingPath, "..", "dev.db");
}

/**
 * Replaces the branch database with a fresh copy of the staging one, once per
 * deployment: a restart of the same deployment keeps its test data. Starts it
 * empty instead when there's no staging database yet, or when staging has a
 * migration the branch lacks (the branch is behind `main`), since the branch
 * couldn't migrate that copy. Returns a note for the boot log.
 */
export async function prepareBranchDb(
  stagingPath: string,
  devPath: string,
  migrationsDir: string,
  deploymentId?: string,
): Promise<string> {
  const stampPath = `${devPath}.deployment`;
  if (deploymentId && existsSync(devPath) && existsSync(stampPath)) {
    if (readFileSync(stampPath, "utf8") === deploymentId) return `kept ${devPath} (same deployment restarted)`;
  }
  const note = await copyStagingDb(stagingPath, devPath, migrationsDir);
  if (deploymentId) writeFileSync(stampPath, deploymentId);
  return note;
}

async function copyStagingDb(stagingPath: string, devPath: string, migrationsDir: string): Promise<string> {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(devPath + suffix, { force: true });
  if (!existsSync(stagingPath)) return "no staging database yet, so the branch starts empty";

  const staging = new Database(stagingPath, { readonly: true, fileMustExist: true });
  try {
    const hasMigrations = staging
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'")
      .get();
    const applied = hasMigrations
      ? (staging
          .prepare("SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL")
          .pluck()
          .all() as string[])
      : [];
    const missing = applied.filter((name) => !existsSync(join(migrationsDir, name)));
    if (missing.length > 0) {
      return (
        `staging has migrations this branch lacks (${missing.join(", ")}), so the branch starts ` +
        "empty. Merge main into the branch to test with staging's data."
      );
    }
    await staging.backup(devPath);
    return `copied ${stagingPath} to ${devPath}`;
  } finally {
    staging.close();
  }
}
