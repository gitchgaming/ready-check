/*
  Warnings:

  - You are about to drop the column `windowOffset` on the `RaidTeam` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RaidTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,
    "displayCount" INTEGER NOT NULL DEFAULT 6
);
INSERT INTO "new_RaidTeam" ("channelId", "createdAt", "guildId", "id", "messageId", "name", "roleId", "timezone") SELECT "channelId", "createdAt", "guildId", "id", "messageId", "name", "roleId", "timezone" FROM "RaidTeam";
DROP TABLE "RaidTeam";
ALTER TABLE "new_RaidTeam" RENAME TO "RaidTeam";
CREATE UNIQUE INDEX "RaidTeam_guildId_roleId_key" ON "RaidTeam"("guildId", "roleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
