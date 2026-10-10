import "dotenv/config";
import { existsSync } from "node:fs";
import { backupConfig, deployKey, runBackup } from "./lib/backup.js";
import { sqlitePath } from "./lib/lanes.js";

// Runs in the container before `prisma migrate deploy` (docker-start.sh), so
// every deploy leaves a copy from before its migrations. Does nothing without
// the BACKUP_* variables (staging) or before the first boot has made a database.
const config = backupConfig(process.env);
const url = process.env.DATABASE_URL;
if (config && url && existsSync(sqlitePath(url))) {
  const key = deployKey(config.prefix, new Date());
  await runBackup(config, url, [key]);
  console.log(`Database backed up to ${key} before migrating.`);
}
