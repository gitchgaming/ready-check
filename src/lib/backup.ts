import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import Database from "better-sqlite3";
import { sqlitePath } from "./lanes.js";

/** Where backups go: a Railway bucket (S3-compatible), wired in through BACKUP_* variables. */
export interface BackupConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Folder in the bucket, so environments could share one ("prod" by default). */
  prefix: string;
}

/** Null when backups aren't set up (local dev, staging), so the bot runs without them. */
export function backupConfig(env: NodeJS.ProcessEnv): BackupConfig | null {
  const { BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_ACCESS_KEY_ID, BACKUP_SECRET_ACCESS_KEY } = env;
  if (!BACKUP_BUCKET || !BACKUP_ENDPOINT || !BACKUP_ACCESS_KEY_ID || !BACKUP_SECRET_ACCESS_KEY) return null;
  return {
    bucket: BACKUP_BUCKET,
    endpoint: BACKUP_ENDPOINT.replace(/\/+$/, ""),
    region: env.BACKUP_REGION || "auto",
    accessKeyId: BACKUP_ACCESS_KEY_ID,
    secretAccessKey: BACKUP_SECRET_ACCESS_KEY,
    prefix: env.BACKUP_PREFIX || "prod",
  };
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * The keys a routine backup is written to. Names repeat, so old copies are
 * overwritten instead of deleted: one per weekday (the last 7 days) and one per
 * month (the latest of each of the last 12 months). Dates are UTC.
 */
export function dailyKeys(prefix: string, now: Date): string[] {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [`${prefix}/daily/${WEEKDAYS[now.getUTCDay()]}.db`, `${prefix}/monthly/${month}.db`];
}

/**
 * The key for the copy taken at boot, before migrations run. Each deploy gets
 * its own (they're rare and small), so the bot's routine backups can never
 * overwrite the last copy from before a migration.
 */
export function deployKey(prefix: string, now: Date): string {
  return `${prefix}/deploys/${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z.db`;
}

/** Virtual-hosted-style object URL (https://<bucket>.<endpoint host>/<key>). */
export function objectUrl(config: BackupConfig, key: string): string {
  const endpoint = new URL(config.endpoint);
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${key}`;
  return endpoint.toString();
}

/** A consistent copy of the live database, taken while the bot keeps writing. */
export async function snapshotDatabase(dbPath: string): Promise<Buffer> {
  const tmp = join(tmpdir(), `ready-check-backup-${process.pid}-${Date.now()}.db`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(tmp);
    return await readFile(tmp);
  } finally {
    db.close();
    await rm(tmp, { force: true });
  }
}

/** Snapshots the database and uploads it under each of `keys`. */
export async function runBackup(
  config: BackupConfig,
  databaseUrl: string,
  keys: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = await snapshotDatabase(sqlitePath(databaseUrl));
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
  for (const key of keys) {
    const request = await aws.sign(objectUrl(config, key), {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/vnd.sqlite3" },
    });
    const res = await fetchImpl(request);
    if (!res.ok) throw new Error(`Backup upload of ${key} failed: ${res.status} ${await res.text()}`);
  }
}
