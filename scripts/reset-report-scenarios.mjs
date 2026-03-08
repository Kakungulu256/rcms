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

async function listByEquals(collectionId, field, value) {
  const result = await databases.listDocuments(databaseId, collectionId, [
    Query.equal(field, [value]),
    Query.limit(100),
  ]);
  return result.documents;
}

async function deleteByEquals(collectionId, field, value) {
  const docs = await listByEquals(collectionId, field, value);
  for (const doc of docs) {
    await databases.deleteDocument(databaseId, collectionId, doc.$id);
  }
  return docs.length;
}

async function main() {
  let deleted = 0;

  deleted += await deleteByEquals("payments", "reference", "SCN26-D-REV");
  deleted += await deleteByEquals("payments", "reference", "SCN26-D-ORIG");
  deleted += await deleteByEquals("payments", "reference", "SCN26-C-LEGACY");
  deleted += await deleteByEquals("payments", "reference", "SCN26-A-OVERPAY");

  deleted += await deleteByEquals("expenses", "description", "SCN26 External Plumbing");
  deleted += await deleteByEquals("expenses", "description", "SCN26 Rent Cash Repair");

  deleted += await deleteByEquals("tenants", "fullName", "SCN26 Tenant D");
  deleted += await deleteByEquals("tenants", "fullName", "SCN26 Tenant C");
  deleted += await deleteByEquals("tenants", "fullName", "SCN26 Tenant A");

  deleted += await deleteByEquals("houses", "code", "SCN26-D");
  deleted += await deleteByEquals("houses", "code", "SCN26-C");
  deleted += await deleteByEquals("houses", "code", "SCN26-A");

  console.log(`Scenario data removed. Deleted documents: ${deleted}`);
}

main().catch((error) => {
  console.error("Scenario reset failed:", error);
  process.exit(1);
});
