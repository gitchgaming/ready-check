import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Production's version is its release tag (vX.Y.Z), which the Release and
// Rollback workflows push before moving `production`. The Docker build looks
// the tag up on GitHub (write-release-info.ts) and bakes it into the image, so
// the bot can show it without any token: the repo is public.

/** What the build found: the tag on the commit being built, if there is one. */
export type ReleaseInfo = { version: string | null; commit: string };

/** Where the Docker image keeps it (see Dockerfile). */
export const RELEASE_INFO_PATH = join("deploy", "release-info.json");

type GitHubTag = { name: string; commit: { sha: string } };

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The highest release tag pointing at `sha`, or null when it isn't a release. */
export function pickReleaseTag(tags: GitHubTag[], sha: string): string | null {
  const versions = tags
    .filter((tag) => tag.commit.sha === sha && RELEASE_TAG.test(tag.name))
    .map((tag) => ({ name: tag.name, parts: RELEASE_TAG.exec(tag.name)!.slice(1).map(Number) }));
  versions.sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  return versions[0]?.name ?? null;
}

/** Asks GitHub's public API which release tag points at `sha`. */
export async function lookUpReleaseTag(
  repo: string,
  sha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/tags?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ready-check-build" },
  });
  if (!res.ok) throw new Error(`GitHub tags lookup failed: ${res.status}`);
  return pickReleaseTag((await res.json()) as GitHubTag[], sha);
}

export function readReleaseInfo(path = RELEASE_INFO_PATH): ReleaseInfo | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseInfo;
}

/** The bot's status in production: the version, or the short commit for an untagged deploy. */
export function releaseLabel(info: ReleaseInfo): string {
  return info.version ?? info.commit.slice(0, 7);
}
