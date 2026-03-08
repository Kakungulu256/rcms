import "dotenv/config";
import {
  Client,
  Databases,
  Permission,
  Role,
  RelationshipType,
  RelationMutate,
  Storage,
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
const storage = new Storage(client);

const databaseId = process.env.APPWRITE_DATABASE_ID || "rcms";
const databaseName = process.env.APPWRITE_DATABASE_NAME || "RCMS";
const receiptsBucketId = process.env.APPWRITE_RECEIPTS_BUCKET_ID || "rcms_receipts";
const receiptsBucketName = process.env.APPWRITE_RECEIPTS_BUCKET_NAME || "RCMS Receipts";

function normalizeEnv(value) {
  const next = (value ?? "").trim();
  return next.length > 0 ? next : null;
}

const teamIds = {
  admin: normalizeEnv(process.env.APPWRITE_TEAM_ADMIN_ID),
  clerk: normalizeEnv(process.env.APPWRITE_TEAM_CLERK_ID),
  viewer: normalizeEnv(process.env.APPWRITE_TEAM_VIEWER_ID),
};

const hasTeamPermissions = Boolean(teamIds.admin && teamIds.clerk && teamIds.viewer);

if (!hasTeamPermissions) {
  console.warn(
    "Team IDs not fully configured. Falling back to Role.users() permissions."
  );
}

const defaultPermissions = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

function buildRolePermissions() {
  if (!hasTeamPermissions) {
    return null;
  }

  const adminTeam = Role.team(teamIds.admin);
  const clerkTeam = Role.team(teamIds.clerk);
  const viewerTeam = Role.team(teamIds.viewer);

  return {
    adminCrud: [
      Permission.read(adminTeam),
      Permission.create(adminTeam),
      Permission.update(adminTeam),
      Permission.delete(adminTeam),
    ],
    clerkReadCreateUpdate: [
      Permission.read(clerkTeam),
      Permission.create(clerkTeam),
      Permission.update(clerkTeam),
    ],
    viewerRead: [Permission.read(viewerTeam)],
  };
}

const rolePermissions = buildRolePermissions();

function getCollectionPermissions(collectionId) {
  if (!rolePermissions) {
    return defaultPermissions;
  }

  if (collectionId === "houses") {
    return [
      ...rolePermissions.adminCrud,
      ...rolePermissions.clerkReadCreateUpdate,
      ...rolePermissions.viewerRead,
    ];
  }

  if (collectionId === "audit_logs") {
    return [
      Permission.read(Role.team(teamIds.admin)),
      Permission.create(Role.team(teamIds.admin)),
      Permission.read(Role.team(teamIds.clerk)),
      Permission.create(Role.team(teamIds.clerk)),
    ];
  }

  return [
    ...rolePermissions.adminCrud,
    ...rolePermissions.clerkReadCreateUpdate,
    ...rolePermissions.viewerRead,
  ];
}

function getReceiptsBucketPermissions() {
  if (!rolePermissions) {
    return defaultPermissions;
  }

  return [
    ...rolePermissions.adminCrud,
    ...rolePermissions.clerkReadCreateUpdate,
    ...rolePermissions.viewerRead,
  ];
}

function isNotFoundError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === 404 || message.includes("not found");
}

async function ensureDatabase() {
  try {
    await databases.get(databaseId);
    console.log(`Database exists: ${databaseId}`);
  } catch (error) {
    console.log(`Creating database: ${databaseId}`);
    await databases.create(databaseId, databaseName);
  }
}

async function ensureReceiptsBucket() {
  const bucketPermissions = getReceiptsBucketPermissions();
  const bucketConfig = {
    name: receiptsBucketName,
    permissions: bucketPermissions,
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 10 * 1024 * 1024,
    allowedFileExtensions: ["jpg", "jpeg", "png", "webp", "pdf"],
    compression: "none",
    encryption: true,
    antivirus: true,
  };

  try {
    await storage.getBucket(receiptsBucketId);
    console.log(`Bucket exists: ${receiptsBucketId}`);
    await storage.updateBucket(
      receiptsBucketId,
      bucketConfig.name,
      bucketConfig.permissions,
      bucketConfig.fileSecurity,
      bucketConfig.enabled,
      bucketConfig.maximumFileSize,
      bucketConfig.allowedFileExtensions,
      bucketConfig.compression,
      bucketConfig.encryption,
      bucketConfig.antivirus
    );
    console.log(`Updated bucket permissions: ${receiptsBucketId}`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    console.log(`Creating bucket: ${receiptsBucketId}`);
    await storage.createBucket(
      receiptsBucketId,
      bucketConfig.name,
      bucketConfig.permissions,
      bucketConfig.fileSecurity,
      bucketConfig.enabled,
      bucketConfig.maximumFileSize,
      bucketConfig.allowedFileExtensions,
      bucketConfig.compression,
      bucketConfig.encryption,
      bucketConfig.antivirus
    );
  }
}

async function ensureCollection(
  collectionId,
  name,
  permissions = getCollectionPermissions(collectionId)
) {
  try {
    const existing = await databases.getCollection(databaseId, collectionId);
    console.log(`Collection exists: ${collectionId}`);
    await databases.updateCollection(
      databaseId,
      collectionId,
      name,
      permissions,
      existing.documentSecurity,
      existing.enabled
    );
    console.log(`Updated collection permissions: ${collectionId}`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    console.log(`Creating collection: ${collectionId}`);
    await databases.createCollection(
      databaseId,
      collectionId,
      name,
      permissions
    );
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
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "tenantType",
      ["new", "old"],
      false
    )
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(
      databaseId,
      collectionId,
      "securityDepositRequired",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(
      databaseId,
      collectionId,
      "securityDepositAmount",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(
      databaseId,
      collectionId,
      "securityDepositPaid",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(
      databaseId,
      collectionId,
      "securityDepositBalance",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(
      databaseId,
      collectionId,
      "securityDepositRefunded",
      false
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
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_tenant_type",
      "key",
      ["tenantType"]
    )
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
    databases.createFloatAttribute(
      databaseId,
      collectionId,
      "securityDepositApplied",
      false
    )
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
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptBucketId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileName", 256, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileMimeType", 128, false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "receiptFileSize", false)
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
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptBucketId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileName", 256, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "receiptFileMimeType", 128, false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "receiptFileSize", false)
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
  await ensureReceiptsBucket();
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
