import path from "node:path";
import dotenv from "dotenv";
import { Client, Query, Storage } from "node-appwrite";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

const endpoint =
  process.env.APPWRITE_ENDPOINT ||
  process.env.VITE_APPWRITE_ENDPOINT;
const projectId =
  process.env.APPWRITE_PROJECT_ID ||
  process.env.VITE_APPWRITE_PROJECT_ID;
const apiKey =
  process.env.APPWRITE_API_KEY ||
  process.env.VITE_APPWRITE_API_KEY;
const bucketIdRaw =
  process.env.APPWRITE_RECEIPTS_BUCKET_ID ||
  process.env.VITE_APPWRITE_RECEIPTS_BUCKET_ID ||
  "rcms_receipts";
const bucketId = String(bucketIdRaw).trim();

const missing = [];
if (!endpoint) missing.push("APPWRITE_ENDPOINT (or VITE_APPWRITE_ENDPOINT)");
if (!projectId) missing.push("APPWRITE_PROJECT_ID (or VITE_APPWRITE_PROJECT_ID)");
if (!apiKey) missing.push("APPWRITE_API_KEY (or VITE_APPWRITE_API_KEY)");

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const dryRun = String(process.env.RCMS_CLEAR_BUCKET_DRY_RUN || "").toLowerCase() === "true";

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);

const storage = new Storage(client);

async function listAllFiles(targetBucketId) {
  const files = [];
  let cursor = null;
  const limit = 100;

  while (true) {
    const queries = [Query.limit(limit)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }
    const page = await storage.listFiles(targetBucketId, queries);
    files.push(...(page.files ?? []));
    if ((page.files ?? []).length < limit) break;
    cursor = page.files[page.files.length - 1].$id;
  }

  return files;
}

async function main() {
  console.log(`Target bucket: ${bucketId}`);
  if (dryRun) {
    console.log("Dry run enabled. No files will be deleted.");
  }

  const files = await listAllFiles(bucketId);
  console.log(`Found ${files.length} file(s).`);

  if (dryRun || files.length === 0) {
    return;
  }

  let deleted = 0;
  for (const file of files) {
    await storage.deleteFile(bucketId, file.$id);
    deleted += 1;
  }

  console.log(`Deleted ${deleted} file(s) from bucket ${bucketId}.`);
}

main().catch((error) => {
  console.error("Bucket clear failed:", error?.message ?? error);
  process.exit(1);
});
