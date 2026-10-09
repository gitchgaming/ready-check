import {
  branchDbPath,
  chooseLane,
  deployLabel,
  lanesEnabled,
  prepareBranchDb,
  readDeployInfo,
  sqlitePath,
} from "./lib/lanes.js";

// Runs first in the container (docker-start.sh) and prints the DATABASE_URL
// the rest of the boot uses. Without DEPLOY_LANES=1 (production) it passes
// DATABASE_URL through. On staging it picks the lane's database (see lanes.ts).
// Logs go to stderr; stdout carries only the URL (so no dotenv, which logs to
// stdout; the container has no .env anyway).

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set.");
  if (!lanesEnabled()) {
    process.stdout.write(url);
    return;
  }

  const info = readDeployInfo();
  const label = deployLabel(process.env, info);
  if (chooseLane(process.env, info) === "main") {
    console.error(`Main lane (${label}): using ${url}`);
    process.stdout.write(url);
    return;
  }

  const stagingPath = sqlitePath(url);
  const devPath = branchDbPath(stagingPath);
  const note = await prepareBranchDb(
    stagingPath,
    devPath,
    "prisma/migrations",
    process.env.RAILWAY_DEPLOYMENT_ID,
  );
  console.error(`Branch lane (${label}): ${note}`);
  process.stdout.write(`file:${devPath}`);
}

main().catch((err: unknown) => {
  console.error("Preparing the database failed:", err);
  process.exit(1);
});
