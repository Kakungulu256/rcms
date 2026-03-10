import "dotenv/config";
import { Client, Databases, ID, Query, Teams, Users } from "node-appwrite";

const REQUIRED_ENV = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const WORKSPACE_SCOPED_COLLECTIONS = [
  "houses",
  "tenants",
  "payments",
  "expenses",
  "security_deposit_deductions",
  "audit_logs",
  "workspace_memberships",
  "workspace_invitations",
  "subscriptions",
  "subscription_events",
  "invoices",
  "payments_billing",
  "coupon_redemptions",
];

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function normalizeEmail(value) {
  const next = normalizeString(value);
  return next ? next.toLowerCase() : null;
}

function parseBoolean(value, fallback = false) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function isValidAppwriteId(value) {
  const next = normalizeString(value);
  if (!next) return false;
  return /^[A-Za-z0-9_][A-Za-z0-9_]{0,35}$/.test(next);
}

function isActiveUser(user) {
  return Boolean(user?.status);
}

const config = {
  databaseId: normalizeString(process.env.APPWRITE_DATABASE_ID) || "rcms",
  workspaceId:
    normalizeString(process.env.RCMS_MIGRATION_WORKSPACE_ID) || "default",
  workspaceName:
    normalizeString(process.env.RCMS_MIGRATION_WORKSPACE_NAME) || "Default Workspace",
  ownerUserId: normalizeString(process.env.RCMS_MIGRATION_OWNER_USER_ID),
  ownerEmail:
    normalizeEmail(process.env.RCMS_MIGRATION_OWNER_EMAIL) ||
    normalizeEmail(process.env.RCMS_ADMIN_EMAIL),
  dryRun: parseBoolean(process.env.RCMS_MIGRATION_DRY_RUN, false),
  includeInactiveUsers: parseBoolean(process.env.RCMS_MIGRATION_INCLUDE_INACTIVE_USERS, true),
  forceOwner: parseBoolean(process.env.RCMS_MIGRATION_FORCE_OWNER, false),
  forceWorkspacePrefs: parseBoolean(process.env.RCMS_MIGRATION_FORCE_WORKSPACE_PREFS, true),
  teamIds: {
    admin: normalizeString(process.env.APPWRITE_TEAM_ADMIN_ID),
    clerk: normalizeString(process.env.APPWRITE_TEAM_CLERK_ID),
    viewer: normalizeString(process.env.APPWRITE_TEAM_VIEWER_ID),
  },
  roleEmails: {
    admin: normalizeEmail(process.env.RCMS_ADMIN_EMAIL),
    clerk: normalizeEmail(process.env.RCMS_CLERK_EMAIL),
    viewer: normalizeEmail(process.env.RCMS_VIEWER_EMAIL),
  },
};

if (!isValidAppwriteId(config.workspaceId)) {
  console.warn(
    `Invalid RCMS_MIGRATION_WORKSPACE_ID "${config.workspaceId}". Falling back to ID.unique().`
  );
  config.workspaceId = ID.unique();
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const users = new Users(client);
const teams = new Teams(client);

async function listAllCollectionDocuments(collectionId, queries = []) {
  const docs = [];
  let cursor = null;
  while (true) {
    const pageQueries = [...queries, Query.limit(100)];
    if (cursor) pageQueries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments(config.databaseId, collectionId, pageQueries);
    const rows = page.documents ?? [];
    docs.push(...rows);
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].$id;
  }
  return docs;
}

async function listAllUsers() {
  const rows = [];
  let offset = 0;
  while (true) {
    const queries = [Query.limit(100), Query.offset(offset)];
    const page = await users.list(queries);
    const batch = page.users ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return rows;
}

async function listAllTeamMemberships(teamId) {
  const memberships = [];
  let offset = 0;
  while (true) {
    const queries = [Query.limit(100), Query.offset(offset)];
    const page = await teams.listMemberships(teamId, queries);
    const batch = page.memberships ?? [];
    memberships.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return memberships;
}

async function resolveOwnerUser(allUsers) {
  if (config.ownerUserId) {
    const user = allUsers.find((row) => row.$id === config.ownerUserId);
    if (!user) {
      throw new Error(`Owner user ID not found: ${config.ownerUserId}`);
    }
    return user;
  }

  if (config.ownerEmail) {
    const user = allUsers.find((row) => normalizeEmail(row.email) === config.ownerEmail);
    if (!user) {
      throw new Error(`Owner email not found: ${config.ownerEmail}`);
    }
    return user;
  }

  throw new Error(
    "Missing owner identity. Set RCMS_MIGRATION_OWNER_USER_ID or RCMS_MIGRATION_OWNER_EMAIL (or RCMS_ADMIN_EMAIL)."
  );
}

async function ensureWorkspace(ownerUser) {
  let workspace = null;
  try {
    workspace = await databases.getDocument(config.databaseId, "workspaces", config.workspaceId);
  } catch {
    workspace = null;
  }

  if (!workspace) {
    if (config.dryRun) {
      console.log(
        `[dry-run] would create workspace ${config.workspaceId} (owner ${ownerUser.$id})`
      );
      return {
        $id: config.workspaceId,
        name: config.workspaceName,
        ownerUserId: ownerUser.$id,
      };
    }
    workspace = await databases.createDocument(
      config.databaseId,
      "workspaces",
      config.workspaceId,
      {
        name: config.workspaceName,
        ownerUserId: ownerUser.$id,
        status: "active",
        subscriptionState: "trialing",
      }
    );
    console.log(`Created workspace: ${workspace.$id}`);
    return workspace;
  }

  const shouldUpdateOwner =
    config.forceOwner || !normalizeString(workspace.ownerUserId);
  if (shouldUpdateOwner && workspace.ownerUserId !== ownerUser.$id) {
    if (config.dryRun) {
      console.log(
        `[dry-run] would set workspace owner ${workspace.$id} -> ${ownerUser.$id}`
      );
      return {
        ...workspace,
        ownerUserId: ownerUser.$id,
      };
    }
    workspace = await databases.updateDocument(config.databaseId, "workspaces", workspace.$id, {
      ownerUserId: ownerUser.$id,
      status: workspace.status || "active",
    });
    console.log(`Updated workspace owner: ${workspace.$id} -> ${ownerUser.$id}`);
  } else if (workspace.ownerUserId && workspace.ownerUserId !== ownerUser.$id) {
    console.warn(
      `Workspace ${workspace.$id} owner is ${workspace.ownerUserId}. Use RCMS_MIGRATION_FORCE_OWNER=true to overwrite.`
    );
  } else {
    console.log(`Workspace exists: ${workspace.$id}`);
  }

  return workspace;
}

async function backfillWorkspaceIds(workspaceId) {
  const summary = {};
  for (const collectionId of WORKSPACE_SCOPED_COLLECTIONS) {
    const documents = await listAllCollectionDocuments(collectionId);
    let missingWorkspaceCount = 0;
    for (const document of documents) {
      const existing = normalizeString(document.workspaceId);
      if (existing) continue;
      missingWorkspaceCount += 1;
      if (config.dryRun) continue;
      await databases.updateDocument(config.databaseId, collectionId, document.$id, {
        workspaceId,
      });
    }
    summary[collectionId] = {
      total: documents.length,
      updated: missingWorkspaceCount,
    };
    console.log(
      `[${collectionId}] total=${documents.length}, missingWorkspaceId=${missingWorkspaceCount}`
    );
  }
  return summary;
}

async function resolveRoleMap(allUsers) {
  const roleMap = new Map();

  const setRoleByEmails = (role, email) => {
    if (!email) return;
    for (const user of allUsers) {
      if (normalizeEmail(user.email) === email) {
        roleMap.set(user.$id, role);
      }
    }
  };

  setRoleByEmails("admin", config.roleEmails.admin);
  setRoleByEmails("clerk", config.roleEmails.clerk);
  setRoleByEmails("viewer", config.roleEmails.viewer);

  const teamRoles = [
    ["admin", config.teamIds.admin],
    ["clerk", config.teamIds.clerk],
    ["viewer", config.teamIds.viewer],
  ];

  for (const [role, teamId] of teamRoles) {
    if (!teamId) continue;
    try {
      const memberships = await listAllTeamMemberships(teamId);
      for (const membership of memberships) {
        const userId = normalizeString(membership.userId);
        if (!userId) continue;
        roleMap.set(userId, role);
      }
    } catch (error) {
      const message = error?.response?.message || error?.message || "Unknown error";
      console.warn(`Failed to load team ${teamId} memberships: ${message}`);
    }
  }

  return roleMap;
}

function mergePrefs(existingPrefs, workspaceId) {
  return {
    ...(existingPrefs ?? {}),
    workspaceId,
  };
}

async function migrateUsersToWorkspace({
  workspaceId,
  ownerUser,
  allUsers,
  roleMap,
}) {
  const existingMembershipDocs = await listAllCollectionDocuments("workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
  ]);
  const membershipByUserId = new Map();
  for (const membership of existingMembershipDocs) {
    const userId = normalizeString(membership.userId);
    if (!userId || membershipByUserId.has(userId)) continue;
    membershipByUserId.set(userId, membership);
  }

  const summary = {
    consideredUsers: 0,
    migratedUsers: 0,
    skippedInactiveUsers: 0,
    createdMemberships: 0,
    updatedMemberships: 0,
    updatedPrefs: 0,
  };

  for (const user of allUsers) {
    if (!config.includeInactiveUsers && !isActiveUser(user)) {
      summary.skippedInactiveUsers += 1;
      continue;
    }

    summary.consideredUsers += 1;
    const userId = user.$id;
    const email = normalizeEmail(user.email);
    const role =
      userId === ownerUser.$id ? "admin" : roleMap.get(userId) || "viewer";
    const invitedByUserId = ownerUser.$id;
    const existingMembership = membershipByUserId.get(userId);

    if (existingMembership) {
      const needsUpdate =
        normalizeEmail(existingMembership.email) !== email ||
        normalizeString(existingMembership.role) !== role ||
        normalizeString(existingMembership.status) !== "active";
      if (needsUpdate) {
        if (config.dryRun) {
          console.log(`[dry-run] would update membership for ${email || userId} -> ${role}`);
        } else {
          await databases.updateDocument(
            config.databaseId,
            "workspace_memberships",
            existingMembership.$id,
            {
              email,
              role,
              status: "active",
              invitedByUserId:
                normalizeString(existingMembership.invitedByUserId) || invitedByUserId,
            }
          );
        }
        summary.updatedMemberships += 1;
      }
    } else {
      if (config.dryRun) {
        console.log(`[dry-run] would create membership for ${email || userId} -> ${role}`);
      } else {
        await databases.createDocument(
          config.databaseId,
          "workspace_memberships",
          ID.unique(),
          {
            workspaceId,
            userId,
            email,
            role,
            status: "active",
            invitedByUserId,
            notes: "Migrated from single-tenant mode",
          }
        );
      }
      summary.createdMemberships += 1;
    }

    const currentWorkspacePref = normalizeString(user?.prefs?.workspaceId);
    const shouldUpdatePrefs = config.forceWorkspacePrefs
      ? currentWorkspacePref !== workspaceId
      : !currentWorkspacePref;
    if (shouldUpdatePrefs) {
      if (config.dryRun) {
        console.log(`[dry-run] would set user prefs workspaceId for ${email || userId}`);
      } else {
        await users.updatePrefs(userId, mergePrefs(user.prefs, workspaceId));
      }
      summary.updatedPrefs += 1;
    }

    summary.migratedUsers += 1;
  }

  return summary;
}

async function main() {
  console.log("Starting single-tenant -> workspace migration");
  console.log(
    JSON.stringify(
      {
        databaseId: config.databaseId,
        workspaceId: config.workspaceId,
        workspaceName: config.workspaceName,
        ownerUserId: config.ownerUserId,
        ownerEmail: config.ownerEmail,
        dryRun: config.dryRun,
      },
      null,
      2
    )
  );

  const allUsers = await listAllUsers();
  if (allUsers.length === 0) {
    throw new Error("No users found in Appwrite project.");
  }
  const ownerUser = await resolveOwnerUser(allUsers);
  const workspace = await ensureWorkspace(ownerUser);
  const backfillSummary = await backfillWorkspaceIds(workspace.$id);
  const roleMap = await resolveRoleMap(allUsers);
  const userSummary = await migrateUsersToWorkspace({
    workspaceId: workspace.$id,
    ownerUser,
    allUsers,
    roleMap,
  });

  console.log("\nMigration complete.");
  console.log(
    JSON.stringify(
      {
        workspaceId: workspace.$id,
        ownerUserId: ownerUser.$id,
        ownerEmail: ownerUser.email || null,
        backfillSummary,
        userSummary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error?.response?.message || error?.message || "Unknown error";
  console.error(`Workspace migration failed: ${message}`);
  process.exit(1);
});
