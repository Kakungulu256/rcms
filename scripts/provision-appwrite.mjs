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

const platformBillingCollectionIds = new Set([
  "plans",
  "feature_entitlements",
  "coupons",
]);

const workspaceBillingCollectionIds = new Set([
  "subscriptions",
  "subscription_events",
  "invoices",
  "payments_billing",
  "coupon_redemptions",
]);

function getCollectionPermissions(collectionId) {
  if (!rolePermissions) {
    return defaultPermissions;
  }

  if (platformBillingCollectionIds.has(collectionId)) {
    if (collectionId === "plans") {
      return [
        Permission.read(Role.any()),
        Permission.read(Role.team(teamIds.admin)),
        Permission.create(Role.team(teamIds.admin)),
        Permission.update(Role.team(teamIds.admin)),
        Permission.delete(Role.team(teamIds.admin)),
      ];
    }

    return [
      Permission.read(Role.team(teamIds.admin)),
      Permission.create(Role.team(teamIds.admin)),
      Permission.update(Role.team(teamIds.admin)),
      Permission.delete(Role.team(teamIds.admin)),
    ];
  }

  if (workspaceBillingCollectionIds.has(collectionId)) {
    return [
      ...rolePermissions.adminCrud,
      ...rolePermissions.viewerRead,
      Permission.read(Role.team(teamIds.clerk)),
    ];
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
  await ensureWorkspaceScope(collectionId);

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
  await ensureWorkspaceScope(collectionId);

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
  await ensureWorkspaceScope(collectionId);

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
  await ensureWorkspaceScope(collectionId);

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
    databases.createBooleanAttribute(
      databaseId,
      collectionId,
      "affectsSecurityDeposit",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "securityDepositDeductionNote",
      512,
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

async function setupSecurityDepositDeductions() {
  const collectionId = "security_deposit_deductions";
  await ensureCollection(collectionId, "Security Deposit Deductions");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "tenantId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "expenseId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "houseId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "deductionDate", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "itemFixed", 256, true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amount", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "deductionNote", 512, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "expenseReference", 64, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_tenant_id", "key", ["tenantId"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_expense_id", "key", ["expenseId"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_deduction_date",
      "key",
      ["deductionDate"]
    )
  );
}

async function setupAuditLogs() {
  const collectionId = "audit_logs";
  await ensureCollection(collectionId, "Audit Logs");
  await ensureWorkspaceScope(collectionId);

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

async function ensureWorkspaceScope(collectionId) {
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "workspaceId", 64, true)
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_workspace", "key", ["workspaceId"])
  );
}

async function setupWorkspaces() {
  const collectionId = "workspaces";
  await ensureCollection(collectionId, "Workspaces");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "name", 128, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "ownerUserId", 64, false)
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
      "subscriptionState",
      ["trialing", "active", "past_due", "canceled", "expired"],
      false
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "trialStartDate", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "trialEndDate", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_workspace_owner",
      "key",
      ["ownerUserId"]
    )
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_workspace_subscription_state",
      "key",
      ["subscriptionState"]
    )
  );
}

async function setupPlans() {
  const collectionId = "plans";
  await ensureCollection(collectionId, "Plans");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "code", 48, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "name", 128, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "description", 1024, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "currency", 8, true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "priceAmount", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "trialDays", false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isActive", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "sortOrder", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "entitlementsJson", 20000, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "limitsJson", 20000, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "metadataJson", 20000, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_plan_code", "key", ["code"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_plan_active", "key", ["isActive"])
  );
}

async function setupFeatureEntitlements() {
  const collectionId = "feature_entitlements";
  await ensureCollection(collectionId, "Feature Entitlements");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "planCode", 48, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "featureKey", 96, true)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "enabled", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "limitValue", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "limitUnit", 32, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );

  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_entitlement_plan_feature",
      "key",
      ["planCode", "featureKey"]
    )
  );
}

async function setupCoupons() {
  const collectionId = "coupons";
  await ensureCollection(collectionId, "Coupons");

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "code", 48, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "name", 128, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "description", 1024, false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "discountPercent", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "appliesToPlanCodesJson",
      20000,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "validFrom", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "validUntil", false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "maxRedemptions", false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(
      databaseId,
      collectionId,
      "maxRedemptionsPerWorkspace",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "redemptionCount", false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "minPlanAmount", false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(databaseId, collectionId, "isActive", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "metadataJson", 20000, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_coupon_code", "key", ["code"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_coupon_active", "key", ["isActive"])
  );
}

async function setupSubscriptions() {
  const collectionId = "subscriptions";
  await ensureCollection(collectionId, "Subscriptions");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "planCode", 48, true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "state",
      ["trialing", "active", "past_due", "canceled", "expired"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "trialStartDate", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "trialEndDate", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(
      databaseId,
      collectionId,
      "currentPeriodStart",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "currentPeriodEnd", false)
  );
  await ensureAttribute(() =>
    databases.createBooleanAttribute(
      databaseId,
      collectionId,
      "cancelAtPeriodEnd",
      false
    )
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "canceledAt", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "endedAt", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "couponCode", 48, false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "discountPercent", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "gatewayProvider", 32, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "gatewayCustomerRef",
      128,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "gatewaySubscriptionRef",
      128,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "notes", 512, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_sub_state", "key", ["state"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_sub_plan", "key", ["planCode"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_sub_gateway_ref",
      "key",
      ["gatewaySubscriptionRef"]
    )
  );
}

async function setupSubscriptionEvents() {
  const collectionId = "subscription_events";
  await ensureCollection(collectionId, "Subscription Events");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "subscriptionId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "eventType", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "eventSource", 32, false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "eventTime", true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "stateFrom",
      ["trialing", "active", "past_due", "canceled", "expired"],
      false
    )
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "stateTo",
      ["trialing", "active", "past_due", "canceled", "expired"],
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "idempotencyKey",
      128,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "payloadJson", 20000, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "actorUserId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "reference", 128, false)
  );

  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_sub_event_subscription",
      "key",
      ["subscriptionId"]
    )
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_sub_event_time", "key", ["eventTime"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_sub_event_idempotency",
      "key",
      ["idempotencyKey"]
    )
  );
}

async function setupInvoices() {
  const collectionId = "invoices";
  await ensureCollection(collectionId, "Invoices");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "subscriptionId", 64, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "invoiceNumber", 64, true)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "status",
      ["draft", "open", "paid", "void", "uncollectible"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "currency", 8, true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "subtotal", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "discountAmount", false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "taxAmount", false)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "totalAmount", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amountDue", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amountPaid", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "dueDate", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "issuedAt", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "paidAt", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "periodStart", false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "periodEnd", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "couponCode", 48, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "metadataJson", 20000, false)
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_invoice_number", "key", ["invoiceNumber"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_invoice_status", "key", ["status"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_invoice_subscription",
      "key",
      ["subscriptionId"]
    )
  );
}

async function setupPaymentsBilling() {
  const collectionId = "payments_billing";
  await ensureCollection(collectionId, "Billing Payments");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "subscriptionId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "invoiceId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "status",
      ["pending", "succeeded", "failed", "refunded", "canceled"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "provider", 32, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "providerReference",
      128,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "providerPaymentId",
      128,
      false
    )
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "amount", true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "currency", 8, true)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "paidAt", false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "failureReason", 512, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "rawPayloadJson", 20000, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "idempotencyKey",
      128,
      false
    )
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_billing_status", "key", ["status"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_billing_provider", "key", ["provider"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_billing_provider_ref",
      "key",
      ["providerReference"]
    )
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_billing_subscription",
      "key",
      ["subscriptionId"]
    )
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_billing_invoice", "key", ["invoiceId"])
  );
  await ensureIndex(() =>
    databases.createIndex(
      databaseId,
      collectionId,
      "idx_billing_idempotency",
      "key",
      ["idempotencyKey"]
    )
  );
}

async function setupCouponRedemptions() {
  const collectionId = "coupon_redemptions";
  await ensureCollection(collectionId, "Coupon Redemptions");
  await ensureWorkspaceScope(collectionId);

  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "couponCode", 48, true)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "subscriptionId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(databaseId, collectionId, "invoiceId", 64, false)
  );
  await ensureAttribute(() =>
    databases.createDatetimeAttribute(databaseId, collectionId, "redeemedAt", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "discountPercent", true)
  );
  await ensureAttribute(() =>
    databases.createFloatAttribute(databaseId, collectionId, "discountAmount", false)
  );
  await ensureAttribute(() =>
    databases.createEnumAttribute(
      databaseId,
      collectionId,
      "status",
      ["applied", "reverted", "expired", "invalid"],
      true
    )
  );
  await ensureAttribute(() =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      "redemptionReference",
      128,
      false
    )
  );

  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_redemption_coupon", "key", ["couponCode"])
  );
  await ensureIndex(() =>
    databases.createIndex(databaseId, collectionId, "idx_redemption_status", "key", ["status"])
  );
}

async function main() {
  await ensureDatabase();
  await ensureReceiptsBucket();
  await setupWorkspaces();
  await setupPlans();
  await setupFeatureEntitlements();
  await setupCoupons();
  await setupSubscriptions();
  await setupSubscriptionEvents();
  await setupInvoices();
  await setupPaymentsBilling();
  await setupCouponRedemptions();
  await setupHouses();
  await setupTenants();
  await setupPayments();
  await setupExpenses();
  await setupSecurityDepositDeductions();
  await setupAuditLogs();
  console.log("Appwrite provisioning complete.");
}

main().catch((error) => {
  console.error("Provisioning failed:", error);
  process.exit(1);
});
