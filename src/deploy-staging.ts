import "dotenv/config";
import { railwayStaging } from "./lib/railway.js";

// `npm run deploy:staging`: deploys the latest commit of `main` to staging (its
// main lane, on the staging database), replacing a branch deploy or bringing
// staging back after it was stopped for local dev.

railwayStaging(["redeploy", "--from-source", "--yes"]);
console.log("Staging is redeploying main on the staging database.");
