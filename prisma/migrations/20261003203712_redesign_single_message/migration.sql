/*
  Warnings:

  - You are about to drop the column `channelId` on the `RaidInstance` table. All the data in the column will be lost.
  - You are about to drop the column `messageId` on the `RaidInstance` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RaidInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raidTeamId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RaidInstance_raidTeamId_fkey" FOREIGN KEY ("raidTeamId") REFERENCES "RaidTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RaidInstance" ("closed", "id", "raidTeamId", "startsAt") SELECT "closed", "id", "raidTeamId", "startsAt" FROM "RaidInstance";
DROP TABLE "RaidInstance";
ALTER TABLE "new_RaidInstance" RENAME TO "RaidInstance";
CREATE UNIQUE INDEX "RaidInstance_raidTeamId_startsAt_key" ON "RaidInstance"("raidTeamId", "startsAt");
CREATE TABLE "new_RaidTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,
    "viewMode" TEXT NOT NULL DEFAULT 'upcoming'
);
INSERT INTO "new_RaidTeam" ("channelId", "createdAt", "guildId", "id", "name", "roleId", "timezone") SELECT "channelId", "createdAt", "guildId", "id", "name", "roleId", "timezone" FROM "RaidTeam";
DROP TABLE "RaidTeam";
ALTER TABLE "new_RaidTeam" RENAME TO "RaidTeam";
CREATE UNIQUE INDEX "RaidTeam_guildId_roleId_key" ON "RaidTeam"("guildId", "roleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
