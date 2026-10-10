import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backupConfig, runBackup } from "../../src/lib/backup.js";
import { makeTeam, resetDb } from "../db.js";

const config = backupConfig({
  BACKUP_BUCKET: "backups",
  BACKUP_ENDPOINT: "https://storage.example.com",
  BACKUP_ACCESS_KEY_ID: "key",
  BACKUP_SECRET_ACCESS_KEY: "secret",
})!;

describe("runBackup", () => {
  it("uploads a signed, readable copy of the live database to each key", async () => {
    await resetDb();
    await makeTeam({ name: "Backup Team" });
    const requests: Request[] = [];
    const fakeFetch = (async (request: Request) => {
      requests.push(request.clone());
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await runBackup(config, process.env.DATABASE_URL!, ["prod/daily/tue.db", "prod/monthly/10.db"], fakeFetch);

    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ["PUT", "https://backups.storage.example.com/prod/daily/tue.db"],
      ["PUT", "https://backups.storage.example.com/prod/monthly/10.db"],
    ]);
    expect(requests[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=key\//);
    const copy = new Database(Buffer.from(await requests[0].arrayBuffer()));
    expect(copy.prepare("SELECT name FROM RaidTeam").all()).toEqual([{ name: "Backup Team" }]);
    copy.close();
  });

  it("fails loudly when the bucket rejects an upload", async () => {
    const rejecting = (async () => new Response("AccessDenied", { status: 403 })) as typeof fetch;
    await expect(runBackup(config, process.env.DATABASE_URL!, ["prod/daily/tue.db"], rejecting)).rejects.toThrow(
      /failed: 403 AccessDenied/,
    );
  });
});
