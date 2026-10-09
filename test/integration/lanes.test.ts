import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareBranchDb } from "../../src/lib/lanes.js";

// The "staging" database is a copy of prisma/test.db, which globalSetup builds
// from the real migrations. Earlier test files may leave rows in it, so these
// tests only look at their own team.

let dir: string;
let staging: string;
let dev: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lanes-"));
  staging = join(dir, "staging.db");
  dev = join(dir, "dev.db");
  cpSync("prisma/test.db", staging);
  const db = new Database(staging);
  db.prepare("INSERT INTO RaidTeam (id, guildId, roleId, name, timezone, channelId) VALUES (?, ?, ?, ?, ?, ?)").run(
    "team-1", "g", "r", "Staging Team", "America/New_York", "c",
  );
  db.close();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const teams = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT name FROM RaidTeam WHERE id = 'team-1'").pluck().all();
  } finally {
    db.close();
  }
};

describe("prepareBranchDb", () => {
  it("copies the staging database and leaves the original alone", async () => {
    const note = await prepareBranchDb(staging, dev, "prisma/migrations", "dep-1");
    expect(note).toMatch(/^copied/);
    expect(teams(dev)).toEqual(["Staging Team"]);

    const db = new Database(dev);
    db.prepare("UPDATE RaidTeam SET name = 'Branch Team' WHERE id = 'team-1'").run();
    db.close();
    expect(teams(staging)).toEqual(["Staging Team"]);
  });

  it("keeps the branch database when the same deployment restarts", async () => {
    await prepareBranchDb(staging, dev, "prisma/migrations", "dep-1");
    const db = new Database(dev);
    db.prepare("UPDATE RaidTeam SET name = 'Branch Team' WHERE id = 'team-1'").run();
    db.close();

    expect(await prepareBranchDb(staging, dev, "prisma/migrations", "dep-1")).toMatch(/^kept/);
    expect(teams(dev)).toEqual(["Branch Team"]);
  });

  it("recopies for a new deployment", async () => {
    await prepareBranchDb(staging, dev, "prisma/migrations", "dep-1");
    const db = new Database(dev);
    db.prepare("UPDATE RaidTeam SET name = 'Branch Team' WHERE id = 'team-1'").run();
    db.close();

    expect(await prepareBranchDb(staging, dev, "prisma/migrations", "dep-2")).toMatch(/^copied/);
    expect(teams(dev)).toEqual(["Staging Team"]);
  });

  it("starts empty when staging has a migration the branch lacks", async () => {
    const migrations = join(dir, "migrations");
    cpSync("prisma/migrations", migrations, { recursive: true });
    const latest = readdirSync(migrations).filter((n) => n !== "migration_lock.toml").sort().at(-1)!;
    rmSync(join(migrations, latest), { recursive: true });
    writeFileSync(dev, "stale");

    const note = await prepareBranchDb(staging, dev, migrations, "dep-1");
    expect(note).toContain(latest);
    expect(existsSync(dev)).toBe(false);
  });

  it("starts empty when there's no staging database yet", async () => {
    rmSync(staging);
    expect(await prepareBranchDb(staging, dev, "prisma/migrations")).toMatch(/starts empty/);
    expect(existsSync(dev)).toBe(false);
  });
});
