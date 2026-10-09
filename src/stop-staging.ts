import "dotenv/config";
import { railwayStaging } from "./lib/railway.js";

// `npm run stop-staging`: removes staging's active deployment (either lane) so
// the local bot can use the shared dev token. `npm run deploy:staging` brings
// main back.

railwayStaging(["down", "--yes"]);
console.log("Staging is stopped. Bring main back with `npm run deploy:staging`.");
