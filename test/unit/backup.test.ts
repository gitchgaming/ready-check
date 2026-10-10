import { describe, expect, it } from "vitest";
import { backupConfig, dailyKeys, deployKey, objectUrl } from "../../src/lib/backup.js";

const env = {
  BACKUP_BUCKET: "ready-check-backups-abc",
  BACKUP_ENDPOINT: "https://storage.example.com/",
  BACKUP_ACCESS_KEY_ID: "key",
  BACKUP_SECRET_ACCESS_KEY: "secret",
};

describe("backupConfig", () => {
  it("is off unless the bucket, endpoint and both keys are set", () => {
    expect(backupConfig({})).toBeNull();
    expect(backupConfig({ ...env, BACKUP_SECRET_ACCESS_KEY: "" })).toBeNull();
  });

  it("defaults the region and folder, and trims the endpoint's trailing slash", () => {
    expect(backupConfig(env)).toEqual({
      bucket: "ready-check-backups-abc",
      endpoint: "https://storage.example.com",
      region: "auto",
      accessKeyId: "key",
      secretAccessKey: "secret",
      prefix: "prod",
    });
    expect(backupConfig({ ...env, BACKUP_REGION: "sjc", BACKUP_PREFIX: "staging" })).toMatchObject({
      region: "sjc",
      prefix: "staging",
    });
  });
});

describe("dailyKeys", () => {
  it("writes one copy per UTC weekday and one per month, so old ones get overwritten", () => {
    // Tue 2026-10-06 in UTC, though it's already Wednesday east of UTC+1.
    expect(dailyKeys("prod", new Date("2026-10-06T23:30:00Z"))).toEqual(["prod/daily/tue.db", "prod/monthly/10.db"]);
    expect(dailyKeys("prod", new Date("2027-01-03T00:00:00Z"))).toEqual(["prod/daily/sun.db", "prod/monthly/01.db"]);
  });
});

describe("deployKey", () => {
  it("gives every deploy its own copy, named by UTC time", () => {
    expect(deployKey("prod", new Date("2026-10-06T23:30:05.123Z"))).toBe("prod/deploys/2026-10-06T23-30-05Z.db");
  });
});

describe("objectUrl", () => {
  it("puts the bucket in the host name", () => {
    const config = backupConfig(env)!;
    expect(objectUrl(config, "prod/daily/tue.db")).toBe(
      "https://ready-check-backups-abc.storage.example.com/prod/daily/tue.db",
    );
  });
});
