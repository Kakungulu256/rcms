import path from "node:path";
import dotenv from "dotenv";
import { Client, Databases, Query } from "node-appwrite";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

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

// Purge children first to satisfy Restrict relationship constraints.
const defaultCollections = [
  "payments",
  "expenses",
  "tenants",
  "houses",
  "audit_logs",
];

const collections = process.env.RCMS_PURGE_COLLECTIONS
  ? process.env.RCMS_PURGE_COLLECTIONS.split(",").map((item) => item.trim()).filter(Boolean)
  : defaultCollections;

const dryRun = String(process.env.RCMS_PURGE_DRY_RUN || "").toLowerCase() === "true";

async function deleteAllDocuments(collectionId) {
  let totalDeleted = 0;

  while (true) {
    const list = await databases.listDocuments(databaseId, collectionId, [Query.limit(100)]);
    if (list.documents.length === 0) break;
    if (dryRun) {
      totalDeleted += list.total;
      break;
    }

    for (const doc of list.documents) {
      await databases.deleteDocument(databaseId, collectionId, doc.$id);
      totalDeleted += 1;
    }
  }

  return totalDeleted;
}

async function main() {
  console.log(`Purging collections: ${collections.join(", ")}`);
  if (dryRun) {
    console.log("Dry run enabled. No documents will be deleted.");
  }

  for (const collectionId of collections) {
    try {
      const deleted = await deleteAllDocuments(collectionId);
      console.log(`${collectionId}: ${dryRun ? "would delete" : "deleted"} ${deleted} documents.`);
    } catch (error) {
      console.error(`Failed to purge ${collectionId}:`, error?.message ?? error);
    }
  }
}

main().catch((error) => {
  console.error("Purge failed:", error);
  process.exit(1);
});
