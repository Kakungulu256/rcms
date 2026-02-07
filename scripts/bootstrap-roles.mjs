import "dotenv/config";
import { Client, Teams, ID } from "node-appwrite";

const requiredEnv = [
  "APPWRITE_ENDPOINT",
  "APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const teams = new Teams(client);

const desiredTeams = [
  { idEnv: "APPWRITE_TEAM_ADMIN_ID", name: "Admin" },
  { idEnv: "APPWRITE_TEAM_CLERK_ID", name: "Clerk" },
  { idEnv: "APPWRITE_TEAM_VIEWER_ID", name: "Viewer" },
];

async function ensureTeam({ idEnv, name }) {
  const explicitId = process.env[idEnv];
  if (explicitId) {
    try {
      const existing = await teams.get(explicitId);
      console.log(`Team exists: ${name} (${existing.$id})`);
      return existing.$id;
    } catch (error) {
      console.warn(`Provided ${idEnv} not found. Will create ${name}.`);
    }
  }

  const list = await teams.list();
  const found = list.teams.find((team) => team.name === name);
  if (found) {
    console.log(`Team exists: ${name} (${found.$id})`);
    return found.$id;
  }

  const created = await teams.create(ID.unique(), name);
  console.log(`Created team: ${name} (${created.$id})`);
  return created.$id;
}

async function main() {
  const adminId = await ensureTeam(desiredTeams[0]);
  const clerkId = await ensureTeam(desiredTeams[1]);
  const viewerId = await ensureTeam(desiredTeams[2]);

  console.log("\nAdd these to your .env for future automation:");
  console.log(`APPWRITE_TEAM_ADMIN_ID=${adminId}`);
  console.log(`APPWRITE_TEAM_CLERK_ID=${clerkId}`);
  console.log(`APPWRITE_TEAM_VIEWER_ID=${viewerId}`);
}

main().catch((error) => {
  console.error("Role bootstrap failed:", error);
  process.exit(1);
});
