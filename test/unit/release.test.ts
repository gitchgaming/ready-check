import { describe, expect, it } from "vitest";
import { lookUpReleaseTag, pickReleaseTag, releaseLabel } from "../../src/lib/release.js";

const SHA = "1a2b3c4d5e6f7a8b9c0d";
const tag = (name: string, sha = SHA) => ({ name, commit: { sha } });

describe("pickReleaseTag", () => {
  it("finds the release tag on the commit", () => {
    expect(pickReleaseTag([tag("v0.1.0", "other"), tag("v0.2.0")], SHA)).toBe("v0.2.0");
  });

  it("is null for a commit that was never released", () => {
    expect(pickReleaseTag([tag("v0.1.0", "other")], SHA)).toBeNull();
  });

  it("ignores tags that aren't releases, and picks the highest of several", () => {
    expect(pickReleaseTag([tag("nightly"), tag("v0.9.0"), tag("v0.10.0"), tag("v0.10.0-rc1")], SHA)).toBe("v0.10.0");
  });
});

describe("lookUpReleaseTag", () => {
  it("reads the repo's tags from GitHub's public API", async () => {
    let url = "";
    const fakeFetch = (async (input: string) => {
      url = input;
      return Response.json([tag("v0.1.0")]);
    }) as unknown as typeof fetch;
    expect(await lookUpReleaseTag("owner/repo", SHA, fakeFetch)).toBe("v0.1.0");
    expect(url).toBe("https://api.github.com/repos/owner/repo/tags?per_page=100");
  });

  it("fails when GitHub does, so the build can fall back to the commit", async () => {
    const failing = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    await expect(lookUpReleaseTag("owner/repo", SHA, failing)).rejects.toThrow(/403/);
  });
});

describe("releaseLabel", () => {
  it("shows the version, or the short commit for an untagged deploy", () => {
    expect(releaseLabel({ version: "v0.1.0", commit: SHA })).toBe("v0.1.0");
    expect(releaseLabel({ version: null, commit: SHA })).toBe("1a2b3c4");
  });
});
