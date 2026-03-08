import "dotenv/config";
import { Client, Databases, Permission, Role, Storage } from "node-appwrite";

const requiredEnv = [
  "APPWRITE_ENDPOINT",
  "APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
  "APPWRITE_DATABASE_ID",
  "APPWRITE_TEAM_ADMIN_ID",
  "APPWRITE_TEAM_CLERK_ID",
  "APPWRITE_TEAM_VIEWER_ID",
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

const databases = new Databases(client);
const storage = new Storage(client);

const databaseId = process.env.APPWRITE_DATABASE_ID;
const receiptsBucketId = process.env.APPWRITE_RECEIPTS_BUCKET_ID || "rcms_receipts";
const collections = [
  "houses",
  "tenants",
  "payments",
  "expenses",
  "audit_logs",
];

const adminTeam = Role.team(process.env.APPWRITE_TEAM_ADMIN_ID);
const clerkTeam = Role.team(process.env.APPWRITE_TEAM_CLERK_ID);
const viewerTeam = Role.team(process.env.APPWRITE_TEAM_VIEWER_ID);

const adminPerms = [
  Permission.read(adminTeam),
  Permission.create(adminTeam),
  Permission.update(adminTeam),
  Permission.delete(adminTeam),
];

const clerkReadCreateUpdatePerms = [
  Permission.read(clerkTeam),
  Permission.create(clerkTeam),
  Permission.update(clerkTeam),
];

const viewerPerms = [Permission.read(viewerTeam)];

function permsForCollection(collectionId) {
  if (collectionId === "houses") {
    return [
      ...adminPerms,
      ...clerkReadCreateUpdatePerms,
      ...viewerPerms,
    ];
  }

  if (collectionId === "audit_logs") {
    return [
      Permission.read(adminTeam),
      Permission.create(adminTeam),
      Permission.read(clerkTeam),
      Permission.create(clerkTeam),
    ];
  }

  return [...adminPerms, ...clerkReadCreateUpdatePerms, ...viewerPerms];
}

function permsForReceiptsBucket() {
  return [...adminPerms, ...clerkReadCreateUpdatePerms, ...viewerPerms];
}

async function applyPermissions(collectionId) {
  const existing = await databases.getCollection({
    databaseId,
    collectionId,
  });
  await databases.updateCollection({
    databaseId,
    collectionId,
    name: existing.name ?? collectionId,
    permissions: permsForCollection(collectionId),
    documentSecurity: existing.documentSecurity,
    enabled: existing.enabled,
  });
  console.log(`Updated permissions for ${collectionId}`);
}

async function applyReceiptsBucketPermissions() {
  const bucket = await storage.getBucket({ bucketId: receiptsBucketId });
  await storage.updateBucket({
    bucketId: receiptsBucketId,
    name: bucket.name,
    permissions: permsForReceiptsBucket(),
  });
  console.log(`Updated permissions for bucket ${receiptsBucketId}`);
}

async function main() {
  for (const collectionId of collections) {
    await applyPermissions(collectionId);
  }
  await applyReceiptsBucketPermissions();
  console.log("Collection and bucket permissions updated.");
}

main().catch((error) => {
  console.error("Failed to update permissions:", error);
  process.exit(1);
});
