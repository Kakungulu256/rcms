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
const scenarioMonth = process.env.REPORT_SCENARIO_MONTH || "2026-06";

if (!/^\d{4}-\d{2}$/.test(scenarioMonth)) {
  console.error("REPORT_SCENARIO_MONTH must be in YYYY-MM format.");
  process.exit(1);
}

function monthFromOffset(base, offset) {
  const value = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function dayInScenario(day) {
  return `${scenarioMonth}-${String(day).padStart(2, "0")}`;
}

async function createIfNotExists(collectionId, field, value, payload) {
  const existing = await databases.listDocuments(databaseId, collectionId, [
    Query.equal(field, [value]),
    Query.limit(1),
  ]);
  if (existing.documents.length > 0) {
    return existing.documents[0];
  }
  return databases.createDocument(databaseId, collectionId, ID.unique(), payload);
}

async function main() {
  const scenarioDate = new Date(`${scenarioMonth}-01T00:00:00Z`);
  const prev2 = monthFromOffset(scenarioDate, -2);
  const prev1 = monthFromOffset(scenarioDate, -1);
  const current = monthFromOffset(scenarioDate, 0);
  const next1 = monthFromOffset(scenarioDate, 1);
  const next2 = monthFromOffset(scenarioDate, 2);
  const next3 = monthFromOffset(scenarioDate, 3);
  const next4 = monthFromOffset(scenarioDate, 4);

  const houseA = await createIfNotExists("houses", "code", "SCN26-A", {
    code: "SCN26-A",
    name: "Scenario A House",
    monthlyRent: 100,
    status: "occupied",
    notes: "SCN26",
  });
  const houseC = await createIfNotExists("houses", "code", "SCN26-C", {
    code: "SCN26-C",
    name: "Scenario C House",
    monthlyRent: 120,
    status: "occupied",
    notes: "SCN26",
  });
  const houseD = await createIfNotExists("houses", "code", "SCN26-D", {
    code: "SCN26-D",
    name: "Scenario D House",
    monthlyRent: 150,
    status: "occupied",
    notes: "SCN26",
  });

  const tenantA = await createIfNotExists("tenants", "fullName", "SCN26 Tenant A", {
    fullName: "SCN26 Tenant A",
    phone: "0700 260 001",
    house: houseA.$id,
    moveInDate: `${prev2}-01`,
    status: "active",
    tenantType: "old",
    securityDepositRequired: false,
    securityDepositAmount: 0,
    securityDepositPaid: 0,
    securityDepositBalance: 0,
    securityDepositRefunded: false,
    notes: "SCN26",
  });
  const tenantC = await createIfNotExists("tenants", "fullName", "SCN26 Tenant C", {
    fullName: "SCN26 Tenant C",
    phone: "0700 260 003",
    house: houseC.$id,
    moveInDate: `${current}-01`,
    status: "active",
    tenantType: "old",
    securityDepositRequired: false,
    securityDepositAmount: 0,
    securityDepositPaid: 0,
    securityDepositBalance: 0,
    securityDepositRefunded: false,
    notes: "SCN26",
  });
  const tenantD = await createIfNotExists("tenants", "fullName", "SCN26 Tenant D", {
    fullName: "SCN26 Tenant D",
    phone: "0700 260 004",
    house: houseD.$id,
    moveInDate: `${current}-01`,
    status: "active",
    tenantType: "old",
    securityDepositRequired: false,
    securityDepositAmount: 0,
    securityDepositPaid: 0,
    securityDepositBalance: 0,
    securityDepositRefunded: false,
    notes: "SCN26",
  });

  await createIfNotExists("payments", "reference", "SCN26-A-OVERPAY", {
    tenant: tenantA.$id,
    amount: 700,
    securityDepositApplied: 0,
    method: "cash",
    paymentDate: dayInScenario(5),
    reference: "SCN26-A-OVERPAY",
    notes: "SCN26 scenario A overpayment",
    allocationJson: JSON.stringify({
      [prev2]: 100,
      [prev1]: 100,
      [current]: 100,
      [next1]: 100,
      [next2]: 100,
      [next3]: 100,
      [next4]: 100,
    }),
    isReversal: false,
  });

  await createIfNotExists("payments", "reference", "SCN26-C-LEGACY", {
    tenant: tenantC.$id,
    amount: 120,
    securityDepositApplied: 0,
    method: "bank",
    paymentDate: dayInScenario(10),
    reference: "SCN26-C-LEGACY",
    notes: "SCN26 scenario C legacy payment without allocation metadata",
    isReversal: false,
  });

  const originalD = await createIfNotExists("payments", "reference", "SCN26-D-ORIG", {
    tenant: tenantD.$id,
    amount: 150,
    securityDepositApplied: 0,
    method: "cash",
    paymentDate: dayInScenario(12),
    reference: "SCN26-D-ORIG",
    notes: "SCN26 scenario D original payment",
    allocationJson: JSON.stringify({
      [current]: 150,
    }),
    isReversal: false,
  });

  await createIfNotExists("payments", "reference", "SCN26-D-REV", {
    tenant: tenantD.$id,
    amount: -150,
    securityDepositApplied: 0,
    method: "cash",
    paymentDate: dayInScenario(12),
    reference: "SCN26-D-REV",
    notes: "SCN26 scenario D reversal",
    allocationJson: JSON.stringify({
      [current]: 150,
    }),
    isReversal: true,
    reversedPaymentId: originalD.$id,
  });

  await createIfNotExists("expenses", "description", "SCN26 Rent Cash Repair", {
    category: "maintenance",
    description: "SCN26 Rent Cash Repair",
    amount: 40,
    source: "rent_cash",
    expenseDate: dayInScenario(15),
    house: houseA.$id,
    notes: "SCN26",
  });

  await createIfNotExists("expenses", "description", "SCN26 External Plumbing", {
    category: "maintenance",
    description: "SCN26 External Plumbing",
    amount: 60,
    source: "external",
    expenseDate: dayInScenario(18),
    house: houseA.$id,
    notes: "SCN26",
  });

  console.log("Scenario data created/verified.");
  console.log(`Scenario month: ${scenarioMonth}`);
  console.log("Expected scenario-only effects for summary report:");
  console.log("- Total Rent Collected contribution: 220");
  console.log("- Rent-cash disbursement contribution: 40");
  console.log("- External expense contribution (should NOT reduce landlord transfer): 60");
  console.log("- Total cash to transfer to Landlord contribution: 180");
}

main().catch((error) => {
  console.error("Scenario seed failed:", error);
  process.exit(1);
});
