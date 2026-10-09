import "dotenv/config";

// Staging runs the dev bot's token on Railway, so a local `npm run dev` would
// answer every interaction a second time. Refuse to start while staging is up.
// Needs RAILWAY_STAGING_TOKEN (a Railway project token for the staging
// environment); without it, only warn. SKIP_STAGING_CHECK=1 bypasses the check.

const API = "https://backboard.railway.com/graphql/v2";

// Statuses where staging is running, or will be once a build or CI wait ends.
const UP = new Set([
  "SUCCESS",
  "SLEEPING",
  "QUEUED",
  "WAITING",
  "BUILDING",
  "INITIALIZING",
  "DEPLOYING",
]);

type Deployment = { status: string; createdAt: string; meta: { commitHash?: string } | null };

async function query<T>(token: string, document: string, variables = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Project-Access-Token": token },
    body: JSON.stringify({ query: document, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  }
  return body.data;
}

async function main() {
  if (process.env.SKIP_STAGING_CHECK === "1") {
    console.warn("Skipping the staging check (SKIP_STAGING_CHECK=1).");
    return;
  }
  const token = process.env.RAILWAY_STAGING_TOKEN;
  if (!token) {
    console.warn(
      "RAILWAY_STAGING_TOKEN is not set, so staging can't be checked. Make sure it's stopped before testing locally.",
    );
    return;
  }

  const { projectToken } = await query<{
    projectToken: { projectId: string; environmentId: string; environment: { name: string } };
  }>(token, "{ projectToken { projectId environmentId environment { name } } }");
  const env = projectToken.environment.name;

  const { deployments } = await query<{ deployments: { edges: { node: Deployment }[] } }>(
    token,
    `query($input: DeploymentListInput!) {
      deployments(first: 10, input: $input) { edges { node { status createdAt meta } } }
    }`,
    { input: { projectId: projectToken.projectId, environmentId: projectToken.environmentId } },
  );
  const up = deployments.edges.map((e) => e.node).filter((d) => UP.has(d.status));

  if (up.length === 0) {
    console.log(`Railway "${env}" is stopped; starting the local bot.`);
    return;
  }
  const d = up[0];
  const commit = d.meta?.commitHash?.slice(0, 7) ?? "a branch deploy";
  console.error(
    `Railway "${env}" is up (${d.status}, ${commit}, ${d.createdAt}). It uses the same bot token, ` +
      "so both would answer every interaction. Stop it first (`npm run stop-staging`), " +
      "or set SKIP_STAGING_CHECK=1 to run anyway.",
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(
    `Couldn't check staging on Railway: ${err instanceof Error ? err.message : String(err)}. ` +
      "Set SKIP_STAGING_CHECK=1 to run anyway.",
  );
  process.exit(1);
});
