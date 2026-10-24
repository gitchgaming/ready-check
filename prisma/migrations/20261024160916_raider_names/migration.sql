-- CreateTable
CREATE TABLE "RaiderName" (
    "raidTeamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("raidTeamId", "userId"),
    CONSTRAINT "RaiderName_raidTeamId_fkey" FOREIGN KEY ("raidTeamId") REFERENCES "RaidTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
