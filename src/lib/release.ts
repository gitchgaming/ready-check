import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Production's version is its release tag (vX.Y.Z). The Release workflow
// commits it to `release.json` on the commit it tags and puts on `production`,
// so the Docker build reads it from the checkout (write-release-info.ts)
// without asking GitHub, and bakes it into the image for the bot's status.

/** What the build found: the release version, if the commit is one. */
export type ReleaseInfo = { version: string | null; commit: string };

/** The file the Release workflow adds to each release commit. */
export const RELEASE_VERSION_PATH = "release.json";

/** Where the Docker image keeps it (see Dockerfile). */
export const RELEASE_INFO_PATH = join("deploy", "release-info.json");

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** The version in `release.json`, or null on a commit that isn't a release. */
export function readReleaseVersion(path = RELEASE_VERSION_PATH): string | null {
  if (!existsSync(path)) return null;
  const { version } = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
  return typeof version === "string" && RELEASE_TAG.test(version) ? version : null;
}

export function readReleaseInfo(path = RELEASE_INFO_PATH): ReleaseInfo | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseInfo;
}

/** The bot's status in production: the version, or the short commit for an untagged deploy. */
export function releaseLabel(info: ReleaseInfo): string {
  return info.version ?? info.commit.slice(0, 7);
}
