import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RELEASE_INFO_PATH, readReleaseVersion, type ReleaseInfo } from "./lib/release.js";

// Runs in the Docker build (see Dockerfile) with Railway's git build variables.
// Writes nothing outside a Railway GitHub deploy (local builds, `railway up`).
// The version comes from the checkout's release.json, so no network is needed;
// a commit without one (an old release, a rollback to one) shows the commit.
const commit = process.env.RAILWAY_GIT_COMMIT_SHA;

if (commit) {
  const version = readReleaseVersion();
  const info: ReleaseInfo = { version, commit };
  mkdirSync(dirname(RELEASE_INFO_PATH), { recursive: true });
  writeFileSync(RELEASE_INFO_PATH, JSON.stringify(info));
  console.log(`Release info: ${version ?? "untagged"} @ ${commit.slice(0, 7)}`);
}
