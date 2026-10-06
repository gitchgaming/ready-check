import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

/** Rebuilds the test database from the committed migrations once per run. */
export default function setup() {
  const url = "file:./prisma/test.db";
  for (const suffix of ["", "-journal"]) rmSync(`prisma/test.db${suffix}`, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
