import { Account, Client, Databases, ID, Query, Teams, Users } from "node-appwrite";

const ALLOWED_ROLES = ["admin", "clerk", "viewer"];

function getEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim().length > 0) {
      return String(value).trim();
    }
  }
  return null;
}

function parseJson(body) {
  if (!body) return null;
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function normalizeWorkspaceId(value) {
  const next = normalizeString(value);
  return next ?? null;
}

function resolveWorkspaceId(body) {
  return (
    normalizeWorkspaceId(body?.workspaceId) ||
    normalizeWorkspaceId(getEnv("RCMS_DEFAULT_WORKSPACE_ID")) ||
    "default"
  );
}

function normalizeEmail(value) {
  const next = normalizeString(value);
  return next ? next.toLowerCase() : null;
}

function normalizeRole(value) {
  const next = normalizeString(value)?.toLowerCase() ?? null;
  return next && ALLOWED_ROLES.includes(next) ? next : null;
}

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getRoleTeamIds() {
  return {
    admin: getEnv("RCMS_APPWRITE_TEAM_ADMIN_ID", "APPWRITE_TEAM_ADMIN_ID"),
    clerk: getEnv("RCMS_APPWRITE_TEAM_CLERK_ID", "APPWRITE_TEAM_CLERK_ID"),
    viewer: getEnv("RCMS_APPWRITE_TEAM_VIEWER_ID", "APPWRITE_TEAM_VIEWER_ID"),
  };
}

function hasAllRoleTeamIds(roleTeamIds) {
  return Boolean(roleTeamIds.admin && roleTeamIds.clerk && roleTeamIds.viewer);
}

function buildClient(endpoint, projectId) {
  return new Client().setEndpoint(endpoint).setProject(projectId);
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isBillingLocked({ workspace, subscription }) {
  const now = new Date();
  const rawState = subscription?.state || workspace?.subscriptionState || "trialing";

  if (rawState === "active") return false;
  if (rawState === "trialing") {
    const trialEnd = parseDateSafe(subscription?.trialEndDate || workspace?.trialEndDate);
    return trialEnd ? trialEnd.getTime() <= now.getTime() : false;
  }
  if (rawState === "past_due") {
    const graceEndsAt = parseDateSafe(subscription?.graceEndsAt);
    return !graceEndsAt || graceEndsAt.getTime() <= now.getTime();
  }
  if (rawState === "canceled") {
    const periodEnd = parseDateSafe(subscription?.currentPeriodEnd);
    return !periodEnd || periodEnd.getTime() <= now.getTime();
  }

  return true;
}

function parseEntitlementsJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.features && typeof parsed.features === "object") {
      return parsed.features;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolvePlanFeatureRule(plan, featureKey) {
  const entitlements = parseEntitlementsJson(plan?.entitlementsJson);
  if (!entitlements || typeof entitlements !== "object") {
    return null;
  }
  const raw = entitlements[featureKey];
  if (typeof raw === "boolean") {
    return { enabled: raw };
  }
  if (raw && typeof raw === "object") {
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
    return { enabled };
  }
  return null;
}

async function getLatestSubscription(databases, databaseId, workspaceId) {
  const page = await databases.listDocuments(databaseId, "subscriptions", [
    Query.equal("workspaceId", [workspaceId]),
    Query.orderDesc("$updatedAt"),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function getPlanByCode(databases, databaseId, planCode) {
  if (!planCode) return null;
  const page = await databases.listDocuments(databaseId, "plans", [
    Query.equal("code", [planCode]),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function getFeatureEntitlement(databases, databaseId, planCode, featureKey) {
  if (!planCode) return null;
  try {
    const page = await databases.listDocuments(databaseId, "feature_entitlements", [
      Query.equal("planCode", [planCode]),
      Query.equal("featureKey", [featureKey]),
      Query.limit(1),
    ]);
    return page.documents?.[0] ?? null;
  } catch {
    return null;
  }
}

async function assertFeatureEnabled({
  databases,
  databaseId,
  workspaceId,
  featureKey,
}) {
  const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
  const subscription = await getLatestSubscription(databases, databaseId, workspaceId);
  if (isBillingLocked({ workspace, subscription })) {
    const error = new Error(
      "Billing is inactive for this workspace. Upgrade or renew to continue."
    );
    error.code = 402;
    throw error;
  }

  const plan = await getPlanByCode(databases, databaseId, subscription?.planCode ?? null);
  const row = await getFeatureEntitlement(
    databases,
    databaseId,
    subscription?.planCode ?? null,
    featureKey
  );

  const fromPlan = resolvePlanFeatureRule(plan, featureKey);
  const enabled =
    typeof row?.enabled === "boolean"
      ? Boolean(row.enabled)
      : fromPlan?.enabled ?? true;

  if (!enabled) {
    const error = new Error(
      `Feature "${featureKey}" is locked by your current plan. Upgrade in Settings to continue.`
    );
    error.code = 402;
    throw error;
  }
}

async function ensureCallerIsAdmin({ endpoint, projectId, jwt, adminTeamId }) {
  if (!jwt) {
    throw Object.assign(new Error("Missing caller JWT."), { code: 401 });
  }

  const callerClient = buildClient(endpoint, projectId).setJWT(jwt);
  const account = new Account(callerClient);
  const teams = new Teams(callerClient);

  const caller = await account.get();
  const teamList = await teams.list();
  const hasAdminTeam = (teamList.teams ?? []).some((team) => {
    const byId = adminTeamId && team.$id === adminTeamId;
    const byName = String(team.name ?? "").trim().toLowerCase() === "admin";
    return byId || byName;
  });

  if (!hasAdminTeam) {
    throw Object.assign(
      new Error("Only admins can create users and assign roles."),
      { code: 403 }
    );
  }

  return caller;
}

async function findUserByEmail(users, email) {
  const list = await users.list([Query.equal("email", [email]), Query.limit(1)]);
  return list.users.find((item) => item.email?.toLowerCase() === email) ?? null;
}

async function listMembershipsForUser(teams, teamId, userId) {
  const memberships = [];
  let cursor = null;

  while (true) {
    const queries = [Query.equal("userId", [userId]), Query.limit(100)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const page = await teams.listMemberships({ teamId, queries });
    memberships.push(...(page.memberships ?? []));

    if ((page.memberships ?? []).length < 100) {
      break;
    }
    cursor = page.memberships[page.memberships.length - 1].$id;
  }

  return memberships;
}

async function removeRoleMemberships(teams, teamId, userId) {
  const memberships = await listMembershipsForUser(teams, teamId, userId);
  for (const membership of memberships) {
    await teams.deleteMembership({ teamId, membershipId: membership.$id });
  }
  return memberships.length;
}

async function ensureRoleMembership(teams, teamId, userId, label) {
  const memberships = await listMembershipsForUser(teams, teamId, userId);
  if (memberships.length > 0) {
    return { created: false, membershipId: memberships[0].$id };
  }

  const created = await teams.createMembership({
    teamId,
    roles: ["member"],
    userId,
    name: label,
  });
  return { created: true, membershipId: created.$id };
}

async function assignExclusiveRoleMembership({
  teams,
  roleTeamIds,
  targetRole,
  userId,
}) {
  let removedCount = 0;
  for (const role of ALLOWED_ROLES) {
    if (role === targetRole) continue;
    removedCount += await removeRoleMemberships(teams, roleTeamIds[role], userId);
  }

  const ensured = await ensureRoleMembership(
    teams,
    roleTeamIds[targetRole],
    userId,
    roleLabel(targetRole)
  );

  return {
    removedCount,
    membershipCreated: ensured.created,
    targetMembershipId: ensured.membershipId,
  };
}

export default async (context) => {
  const { req, res, error: logError } = context;
  const body = parseJson(req.body);
  if (!body) {
    return res.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const endpoint = getEnv(
    "RCMS_APPWRITE_ENDPOINT",
    "APPWRITE_ENDPOINT",
    "APPWRITE_FUNCTION_API_ENDPOINT"
  );
  const projectId = getEnv(
    "RCMS_APPWRITE_PROJECT_ID",
    "APPWRITE_PROJECT_ID",
    "APPWRITE_FUNCTION_PROJECT_ID"
  );
  const apiKey = getEnv(
    "RCMS_APPWRITE_API_KEY",
    "APPWRITE_API_KEY",
    "APPWRITE_FUNCTION_API_KEY"
  );
  const databaseId = getEnv("RCMS_APPWRITE_DATABASE_ID", "APPWRITE_DATABASE_ID") || "rcms";
  const roleTeamIds = getRoleTeamIds();

  if (!endpoint || !projectId || !apiKey) {
    return res.json(
      {
        ok: false,
        error:
          "Missing function credentials. Set endpoint, project ID, and API key env vars.",
      },
      500
    );
  }
  if (!hasAllRoleTeamIds(roleTeamIds)) {
    return res.json(
      {
        ok: false,
        error:
          "Missing role team IDs. Set admin, clerk, and viewer team IDs in function env vars.",
      },
      500
    );
  }

  const jwt = normalizeString(body.jwt);
  const workspaceId = resolveWorkspaceId(body);
  const email = normalizeEmail(body.email);
  const name = normalizeString(body.name) ?? "Team User";
  const role = normalizeRole(body.role);
  const password = normalizeString(body.password);

  if (!email) {
    return res.json({ ok: false, error: "Email is required." }, 400);
  }
  if (!role) {
    return res.json(
      { ok: false, error: "Role must be one of: admin, clerk, viewer." },
      400
    );
  }

  try {
    await ensureCallerIsAdmin({
      endpoint,
      projectId,
      jwt,
      adminTeamId: roleTeamIds.admin,
    });

    const adminClient = buildClient(endpoint, projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const users = new Users(adminClient);
    const teams = new Teams(adminClient);

    await assertFeatureEnabled({
      databases,
      databaseId,
      workspaceId,
      featureKey: "settings.manage_users",
    });

    let user = await findUserByEmail(users, email);
    let created = false;

    if (!user) {
      if (!password || password.length < 8) {
        return res.json(
          {
            ok: false,
            error: "Password is required for new users and must be at least 8 characters.",
          },
          400
        );
      }
      user = await users.create({
        userId: ID.unique(),
        email,
        password,
        name,
      });
      created = true;
    } else if (name && user.name !== name) {
      user = await users.updateName({ userId: user.$id, name });
    }

    const existingWorkspaceId = normalizeWorkspaceId(user?.prefs?.workspaceId);
    if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
      return res.json(
        {
          ok: false,
          error:
            "User already belongs to another workspace and cannot be assigned here.",
        },
        409
      );
    }
    if (!existingWorkspaceId) {
      user = await users.updatePrefs({
        userId: user.$id,
        prefs: {
          ...(user.prefs ?? {}),
          workspaceId,
        },
      });
    }

    const membershipResult = await assignExclusiveRoleMembership({
      teams,
      roleTeamIds,
      targetRole: role,
      userId: user.$id,
    });

    return res.json({
      ok: true,
      created,
      role,
      user: {
        id: user.$id,
        email: user.email ?? email,
        name: user.name ?? name,
        workspaceId,
      },
      membership: membershipResult,
    });
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message ??
      error?.message ??
      "Failed to create or assign user role.";
    logError?.(`manageUsers failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};
