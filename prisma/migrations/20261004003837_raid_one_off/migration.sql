-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RaidInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raidTeamId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "oneOff" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RaidInstance_raidTeamId_fkey" FOREIGN KEY ("raidTeamId") REFERENCES "RaidTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RaidInstance" ("cancelled", "closed", "id", "raidTeamId", "startsAt") SELECT "cancelled", "closed", "id", "raidTeamId", "startsAt" FROM "RaidInstance";
DROP TABLE "RaidInstance";
ALTER TABLE "new_RaidInstance" RENAME TO "RaidInstance";
CREATE UNIQUE INDEX "RaidInstance_raidTeamId_startsAt_key" ON "RaidInstance"("raidTeamId", "startsAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
