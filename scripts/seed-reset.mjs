import "dotenv/config";
import { Client, Databases, Query } from "node-appwrite";

const required = [
  "APPWRITE_ENDPOINT",
  "APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
  "APPWRITE_DATABASE_ID",
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

const databases = new Databases(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;

async function deleteByQuery(collectionId, queries) {
  const list = await databases.listDocuments(databaseId, collectionId, queries);
  for (const doc of list.documents) {
    await databases.deleteDocument(databaseId, collectionId, doc.$id);
  }
}

async function main() {
  await deleteByQuery("payments", [Query.equal("reference", ["SEED-001"])]);
  await deleteByQuery("expenses", [Query.equal("notes", ["Seeded expense"])]);
  await deleteByQuery("tenants", [Query.equal("notes", ["Seeded tenant"])]);
  await deleteByQuery("houses", [Query.equal("notes", ["Seeded"])]);
  console.log("Seed data removed.");
}

main().catch((error) => {
  console.error("Seed reset failed:", error);
  process.exit(1);
});
