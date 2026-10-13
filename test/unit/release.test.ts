import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readReleaseVersion, releaseLabel } from "../../src/lib/release.js";

const SHA = "1a2b3c4d5e6f7a8b9c0d";

function releaseFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "release-")), "release.json");
  writeFileSync(path, contents);
  return path;
}

describe("readReleaseVersion", () => {
  it("reads the version the Release workflow wrote", () => {
    expect(readReleaseVersion(releaseFile('{"version":"v0.5.0"}'))).toBe("v0.5.0");
  });

  it("is null for a commit that was never released", () => {
    expect(readReleaseVersion(join(tmpdir(), "no-such-dir", "release.json"))).toBeNull();
  });

  it("ignores a version that isn't a release tag", () => {
    expect(readReleaseVersion(releaseFile('{"version":"nightly"}'))).toBeNull();
    expect(readReleaseVersion(releaseFile("{}"))).toBeNull();
  });
});

describe("releaseLabel", () => {
  it("shows the version, or the short commit for an untagged deploy", () => {
    expect(releaseLabel({ version: "v0.1.0", commit: SHA })).toBe("v0.1.0");
    expect(releaseLabel({ version: null, commit: SHA })).toBe("1a2b3c4");
  });
});
