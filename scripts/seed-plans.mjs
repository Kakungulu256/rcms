import "dotenv/config";
import { Client, Databases, ID, Query } from "node-appwrite";

const required = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"];
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
const databaseId = process.env.APPWRITE_DATABASE_ID || "rcms";

const PLANS = [
  {
    code: "trial",
    name: "Trial",
    description: "Short trial access with light limits.",
    currency: "UGX",
    priceAmount: 0,
    trialDays: 5,
    isActive: true,
    sortOrder: 1,
    limits: {
      maxProperties: 1,
      maxLandlords: 1,
      maxHouses: 10,
      maxActiveTenants: 20,
      maxTeamMembers: 2,
      exportsPerMonth: 10,
    },
  },
  {
    code: "starter",
    name: "Starter",
    description: "Small landlord plan.",
    currency: "UGX",
    priceAmount: 49000,
    trialDays: 0,
    isActive: true,
    sortOrder: 2,
    limits: {
      maxProperties: 2,
      maxLandlords: 3,
      maxHouses: 40,
      maxActiveTenants: 120,
      maxTeamMembers: 5,
      exportsPerMonth: 60,
    },
  },
  {
    code: "growth",
    name: "Growth",
    description: "Property manager plan.",
    currency: "UGX",
    priceAmount: 149000,
    trialDays: 0,
    isActive: true,
    sortOrder: 3,
    limits: {
      maxProperties: 8,
      maxLandlords: 12,
      maxHouses: 180,
      maxActiveTenants: 600,
      maxTeamMembers: 20,
      exportsPerMonth: 250,
    },
  },
  {
    code: "agency",
    name: "Agency",
    description: "Agency scale plan.",
    currency: "UGX",
    priceAmount: 349000,
    trialDays: 0,
    isActive: true,
    sortOrder: 4,
    limits: {
      maxProperties: 25,
      maxLandlords: 40,
      maxHouses: 600,
      maxActiveTenants: 2000,
      maxTeamMembers: 60,
      exportsPerMonth: 1000,
    },
  },
];

function buildPayload(plan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    currency: plan.currency,
    priceAmount: plan.priceAmount,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    limitsJson: JSON.stringify(plan.limits),
  };
}

async function upsertPlan(plan) {
  const existing = await databases.listDocuments(databaseId, "plans", [
    Query.equal("code", [plan.code]),
    Query.limit(1),
  ]);
  const payload = buildPayload(plan);
  if (existing.documents.length > 0) {
    const current = existing.documents[0];
    await databases.updateDocument(databaseId, "plans", current.$id, payload);
    return { action: "updated", id: current.$id };
  }
  const created = await databases.createDocument(
    databaseId,
    "plans",
    ID.unique(),
    payload
  );
  return { action: "created", id: created.$id };
}

async function main() {
  const results = [];
  for (const plan of PLANS) {
    const result = await upsertPlan(plan);
    results.push({ code: plan.code, ...result });
  }
  console.log("Plan seed complete:");
  results.forEach((row) =>
    console.log(`- ${row.code}: ${row.action} (${row.id})`)
  );
}

main().catch((error) => {
  console.error("Plan seed failed:", error);
  process.exit(1);
});
