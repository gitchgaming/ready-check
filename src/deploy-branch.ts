import "dotenv/config";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { DEPLOY_INFO_FILE, type DeployInfo } from "./lib/lanes.js";
import { railwayStaging, run, stagingToken } from "./lib/railway.js";

// `npm run deploy:branch`: uploads this working tree (uncommitted changes
// included) to staging's branch lane, replacing whatever staging runs. The
// branch gets a fresh copy of the staging database; staging's own is never
// touched (see src/lib/lanes.ts). `npm run deploy:staging` puts `main` back,
// and so does any merge to main.
//
// Railway's Wait for CI doesn't cover `railway up`, so this runs the
// type-checks and tests first. `--skip-checks` skips them.

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

stagingToken();
const commit = git("rev-parse", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const info: DeployInfo = {
  branch: branch === "HEAD" ? "detached" : branch,
  commit,
  dirty: git("status", "--porcelain").length > 0,
  deployedAt: new Date().toISOString(),
};

if (!process.argv.includes("--skip-checks")) {
  run("npx", ["tsc", "--noEmit"]);
  run("npx", ["tsc", "-p", "test"]);
  run("npm", ["test"]);
}

const label = `${info.branch} @ ${commit.slice(0, 7)}${info.dirty ? " (uncommitted changes)" : ""}`;
console.log(`Deploying ${label} to staging's branch lane…`);
writeFileSync(DEPLOY_INFO_FILE, JSON.stringify(info, null, 2));
try {
  railwayStaging(["up", "--ci", "--message", `branch lane: ${label}`]);
} finally {
  rmSync(DEPLOY_INFO_FILE, { force: true });
}
console.log(
  "Built. Staging now runs this branch on a copy of its database (live in a minute or two).\n" +
    "Put main back with `npm run deploy:staging` (a merge to main does it too).",
);
