import "dotenv/config";
import { Client, ID, Query, Teams, Users } from "node-appwrite";

const required = [
  "APPWRITE_ENDPOINT",
  "APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
  "APPWRITE_TEAM_ADMIN_ID",
  "APPWRITE_TEAM_CLERK_ID",
  "APPWRITE_TEAM_VIEWER_ID",
  "RCMS_ADMIN_EMAIL",
  "RCMS_ADMIN_PASSWORD",
  "RCMS_CLERK_EMAIL",
  "RCMS_CLERK_PASSWORD",
  "RCMS_VIEWER_EMAIL",
  "RCMS_VIEWER_PASSWORD",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const users = new Users(client);
const teams = new Teams(client);

async function getOrCreateUser(email, password, name) {
  const list = await users.list([Query.equal("email", [email])]);
  const existing = list.users.find((user) => user.email === email);
  if (existing) {
    return existing;
  }
  return users.create(ID.unique(), email, undefined, password, name);
}

async function ensureMembership(teamId, userId, label) {
  const memberships = await teams.listMemberships(teamId);
  const exists = memberships.memberships.find(
    (membership) => membership.userId === userId
  );
  if (exists) {
    return exists;
  }
  return teams.createMembership(teamId, ["member"], undefined, userId, undefined, undefined, label);
}

async function main() {
  const admin = await getOrCreateUser(
    process.env.RCMS_ADMIN_EMAIL,
    process.env.RCMS_ADMIN_PASSWORD,
    process.env.RCMS_ADMIN_NAME ?? "Admin"
  );
  const clerk = await getOrCreateUser(
    process.env.RCMS_CLERK_EMAIL,
    process.env.RCMS_CLERK_PASSWORD,
    process.env.RCMS_CLERK_NAME ?? "Clerk"
  );
  const viewer = await getOrCreateUser(
    process.env.RCMS_VIEWER_EMAIL,
    process.env.RCMS_VIEWER_PASSWORD,
    process.env.RCMS_VIEWER_NAME ?? "Viewer"
  );

  await ensureMembership(process.env.APPWRITE_TEAM_ADMIN_ID, admin.$id, "Admin");
  await ensureMembership(process.env.APPWRITE_TEAM_CLERK_ID, clerk.$id, "Clerk");
  await ensureMembership(process.env.APPWRITE_TEAM_VIEWER_ID, viewer.$id, "Viewer");

  console.log("Users created/verified and assigned to teams.");
  console.log(`Admin: ${admin.$id}`);
  console.log(`Clerk: ${clerk.$id}`);
  console.log(`Viewer: ${viewer.$id}`);
}

main().catch((error) => {
  console.error("Bootstrap users failed:", error);
  process.exit(1);
});
