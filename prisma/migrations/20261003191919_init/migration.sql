-- CreateTable
CREATE TABLE "RaidTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RaidSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raidTeamId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    CONSTRAINT "RaidSlot_raidTeamId_fkey" FOREIGN KEY ("raidTeamId") REFERENCES "RaidTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RaidInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raidTeamId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RaidInstance_raidTeamId_fkey" FOREIGN KEY ("raidTeamId") REFERENCES "RaidTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raidInstanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Attendance_raidInstanceId_fkey" FOREIGN KEY ("raidInstanceId") REFERENCES "RaidInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RaidTeam_guildId_roleId_key" ON "RaidTeam"("guildId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RaidSlot_raidTeamId_dayOfWeek_hour_minute_key" ON "RaidSlot"("raidTeamId", "dayOfWeek", "hour", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "RaidInstance_raidTeamId_startsAt_key" ON "RaidInstance"("raidTeamId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_raidInstanceId_userId_key" ON "Attendance"("raidInstanceId", "userId");
