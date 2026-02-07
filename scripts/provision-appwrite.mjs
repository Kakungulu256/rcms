import "dotenv/config";
import {
  Client,
  Databases,
  ID,
  Permission,
  Role,
  RelationshipType,
  RelationMutate,
} from "node-appwrite";

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

const databases = new Databases(client);

const databaseId = process.env.APPWRITE_DATABASE_ID || "rcms";
const databaseName = process.env.APPWRITE_DATABASE_NAME || "RCMS";

const defaultPermissions = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

async function ensureDatabase() {
  try {
    await databases.get(databaseId);
    console.log(`Database exists: ${databaseId}`);
  } catch (error) {
    console.log(`Creating database: ${databaseId}`);
    await databases.create(databaseId, databaseName);
  }
}

async function ensureCollection(collectionId, name, permissions = defaultPermissions) {
  try {
    await databases.getCollection(databaseId, collectionId);
    console.log(`Collection exists: ${collectionId}`);
  } catch (error) {
    console.log(`Creating collection: ${collectionId}`);
    await databases.createCollection(databaseId, collectionId, name, permissions);
  }
}

async function ensureAttribute(fn) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("already exists")) {
      console.error(message);
      throw error;
    }
  }
}

async function ensureRelationship(fn) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("already exists")) {
      console.error(message);
      throw error;
    }
  }
}

async function ensureIndex(fn) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("already exists")) {
      console.error(message);
      throw error;
    }
  }
}

async function setupHouses() {
  const collectionId = "houses";
  await ensureCollection(collectionId, "Houses");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "code", 32, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "name", 128, false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "monthlyRent", true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "status",
      ["occupied", "vacant", "inactive"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "currentTenantId",
      64,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "rentHistoryJson",
      20000,
      false
    )
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_status", "key", ["status"])
  );
}

async function setupTenants() {
  const collectionId = "tenants";
  await ensureCollection(collectionId, "Tenants");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "fullName", 128, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "phone", 32, false)
  );
  await ensureRelationship(() =>
    databases.createRelationshipAttribute(
      databaseId,
      collectionId,
      "houses",
      RelationshipType.ManyToOne,
      true,
      "house",
      "tenants",
      RelationMutate.Restrict
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "moveInDate", true)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "moveOutDate", false)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "status",
      ["active", "inactive"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "rentOverride", false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isMigrated", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "rentHistoryJson",
      20000,
      false
    )
  );

  // Relationship attributes are already indexed by Appwrite.
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_status", "key", ["status"])
  );
}

async function setupPayments() {
  const collectionId = "payments";
  await ensureCollection(collectionId, "Payments");

  await ensureRelationship(() =>
    databases.createRelationshipAttribute(
      databaseId,
      collectionId,
      "tenants",
      RelationshipType.ManyToOne,
      true,
      "tenant",
      "payments",
      RelationMutate.Restrict
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amount", true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "method",
      ["cash", "bank"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "paymentDate", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "recordedBy", 64, false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isMigrated", false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isReversal", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "reversedPaymentId",
      64,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "reference", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "allocationJson",
      20000,
      false
    )
  );

  // Relationship attributes are already indexed by Appwrite.
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_payment_date",
      "key",
      ["paymentDate"]
    )
  );
}

async function setupExpenses() {
  const collectionId = "expenses";
  await ensureCollection(collectionId, "Expenses");

  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "category",
      ["general", "maintenance"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "description", 256, true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amount", true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "source",
      ["rent_cash", "external"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "expenseDate", true)
  );
  await ensureRelationship(() =>
    databases.createRelationshipAttribute(
      databaseId,
      collectionId,
      "houses",
      RelationshipType.ManyToOne,
      true,
      "house",
      "expenses",
      RelationMutate.SetNull
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "maintenanceType",
      64,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isMigrated", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_category", "key", ["category"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_expense_date",
      "key",
      ["expenseDate"]
    )
  );
  // Relationship attributes are already indexed by Appwrite.
}

async function setupAuditLogs() {
  const collectionId = "audit_logs";
  await ensureCollection(collectionId, "Audit Logs");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "entityType", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "entityId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "action",
      ["create", "update", "reverse", "delete"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "actorId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "timestamp", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "detailsJson",
      20000,
      false
    )
  );

  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_entity",
      "key",
      ["entityType", "entityId"]
    )
  );
}

async function main() {
  await ensureDatabase();
  await setupHouses();
  await setupTenants();
  await setupPayments();
  await setupExpenses();
  await setupAuditLogs();
  console.log("Appwrite provisioning complete.");
}

main().catch((error) => {
  console.error("Provisioning failed:", error);
  process.exit(1);
});
