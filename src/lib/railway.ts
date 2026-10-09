import { spawnSync } from "node:child_process";

// Runs the Railway CLI against staging, authenticated by RAILWAY_STAGING_TOKEN
// (a project token for the staging environment). STAGING_SERVICE names the
// service if it isn't "ready-check".

export const stagingService = () => process.env.STAGING_SERVICE || "ready-check";

export function stagingToken(): string {
  const token = process.env.RAILWAY_STAGING_TOKEN;
  if (!token) {
    console.error("RAILWAY_STAGING_TOKEN is not set (a Railway project token for staging; see .env.example).");
    process.exit(1);
  }
  return token;
}

/** Runs a command, inheriting stdio; exits with its status if it fails. */
export function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\`${command} ${args.join(" ")}\` failed.`);
    process.exit(result.status ?? 1);
  }
}

export function railwayStaging(args: string[]) {
  run("railway", [...args, "--service", stagingService()], { ...process.env, RAILWAY_TOKEN: stagingToken() });
}
