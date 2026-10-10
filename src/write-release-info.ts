import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { lookUpReleaseTag, RELEASE_INFO_PATH, type ReleaseInfo } from "./lib/release.js";

// Runs in the Docker build (see Dockerfile) with Railway's git build variables.
// Writes nothing outside a Railway GitHub deploy (local builds, `railway up`);
// when GitHub can't be reached it records the commit alone, so the bot still
// shows something.
const commit = process.env.RAILWAY_GIT_COMMIT_SHA;
const owner = process.env.RAILWAY_GIT_REPO_OWNER;
const repo = process.env.RAILWAY_GIT_REPO_NAME;

if (commit && owner && repo) {
  const version = await lookUpReleaseTag(`${owner}/${repo}`, commit).catch((err) => {
    console.warn(`Couldn't look up the release tag: ${err}`);
    return null;
  });
  const info: ReleaseInfo = { version, commit };
  mkdirSync(dirname(RELEASE_INFO_PATH), { recursive: true });
  writeFileSync(RELEASE_INFO_PATH, JSON.stringify(info));
  console.log(`Release info: ${version ?? "untagged"} @ ${commit.slice(0, 7)}`);
}
