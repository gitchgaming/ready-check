import { describe, expect, it } from "vitest";
import { branchDbPath, chooseLane, deployLabel, lanesEnabled, sqlitePath, type DeployInfo } from "../../src/lib/lanes.js";

const info: DeployInfo = {
  branch: "my-branch",
  commit: "1a2b3c4d5e6f",
  dirty: false,
  deployedAt: "2026-10-09T12:00:00Z",
};

describe("chooseLane", () => {
  it("runs the main lane only for a GitHub deploy of main", () => {
    expect(chooseLane({ RAILWAY_GIT_BRANCH: "main" }, null)).toBe("main");
  });

  it("runs the branch lane for a branch deploy, even one made from main", () => {
    expect(chooseLane({}, info)).toBe("branch");
    expect(chooseLane({ RAILWAY_GIT_BRANCH: "main" }, info)).toBe("branch");
  });

  it("falls back to the branch lane when the deploy can't be identified", () => {
    expect(chooseLane({}, null)).toBe("branch");
    expect(chooseLane({ RAILWAY_GIT_BRANCH: "other" }, null)).toBe("branch");
  });
});

describe("deployLabel", () => {
  it("names the branch and short commit, starred when uncommitted changes went up", () => {
    expect(deployLabel({}, info)).toBe("my-branch @ 1a2b3c4");
    expect(deployLabel({}, { ...info, dirty: true })).toBe("my-branch @ 1a2b3c4*");
  });

  it("uses Railway's git variables for a GitHub deploy", () => {
    expect(deployLabel({ RAILWAY_GIT_BRANCH: "main", RAILWAY_GIT_COMMIT_SHA: "abcdef0123" }, null)).toBe(
      "main @ abcdef0",
    );
  });
});

describe("lanesEnabled", () => {
  it("is on only with DEPLOY_LANES=1", () => {
    expect(lanesEnabled({ DEPLOY_LANES: "1" })).toBe(true);
    expect(lanesEnabled({})).toBe(false);
  });
});

describe("database paths", () => {
  it("puts the branch database next to the staging one", () => {
    expect(branchDbPath(sqlitePath("file:/data/staging.db"))).toBe("/data/dev.db");
  });

  it("rejects non-file URLs", () => {
    expect(() => sqlitePath("postgres://x")).toThrow(/file: URL/);
  });
});
