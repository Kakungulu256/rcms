import "dotenv/config";
import { Client, Databases, ID, Query } from "node-appwrite";

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

async function createIfNotExists(collectionId, field, value, payload) {
  const existing = await databases.listDocuments(databaseId, collectionId, [
    Query.equal(field, [value]),
  ]);
  if (existing.documents.length > 0) {
    return existing.documents[0];
  }
  return databases.createDocument(databaseId, collectionId, ID.unique(), payload);
}

async function main() {
  const houseA = await createIfNotExists("houses", "code", "A-101", {
    code: "A-101",
    name: "Block A - 101",
    monthlyRent: 12000,
    status: "occupied",
    notes: "Seeded",
  });

  const houseB = await createIfNotExists("houses", "code", "B-202", {
    code: "B-202",
    name: "Block B - 202",
    monthlyRent: 9000,
    status: "vacant",
    notes: "Seeded",
  });

  const tenant = await createIfNotExists("tenants", "fullName", "Jane Doe", {
    fullName: "Jane Doe",
    phone: "0700 000 000",
    house: houseA.$id,
    moveInDate: new Date().toISOString().slice(0, 10),
    status: "active",
    notes: "Seeded tenant",
  });

  await databases.createDocument(databaseId, "expenses", ID.unique(), {
    category: "general",
    description: "Caretaker salary",
    amount: 5000,
    source: "rent_cash",
    expenseDate: new Date().toISOString().slice(0, 10),
    notes: "Seeded expense",
  });

  await databases.createDocument(databaseId, "payments", ID.unique(), {
    tenant: tenant.$id,
    amount: 12000,
    method: "cash",
    paymentDate: new Date().toISOString().slice(0, 10),
    reference: "SEED-001",
    allocationJson: JSON.stringify({
      [new Date().toISOString().slice(0, 7)]: 12000,
    }),
  });

  console.log("Seed data created.");
  console.log(`House A: ${houseA.$id}`);
  console.log(`House B: ${houseB.$id}`);
  console.log(`Tenant: ${tenant.$id}`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
