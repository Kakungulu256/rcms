import { Account, Client, Databases, ID, Query, Users } from "node-appwrite";

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

function parseLimitsJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.limits && typeof parsed.limits === "object") {
      return parsed.limits;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolvePlanLimit(plan, keys) {
  const limits = parseLimitsJson(plan?.limitsJson);
  if (!limits || typeof limits !== "object") return null;
  for (const key of keys) {
    const value = Number(limits[key]);
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
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

async function countActiveWorkspaceMembers(databases, databaseId, workspaceId) {
  const page = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("status", ["active"]),
    Query.limit(1),
  ]);
  return Number(page.total ?? 0);
}

async function findUserByEmail(users, email) {
  const list = await users.list([Query.equal("email", [email]), Query.limit(1)]);
  return list.users.find((item) => item.email?.toLowerCase() === email) ?? null;
}

async function findWorkspaceMembership(databases, databaseId, workspaceId, userId) {
  const page = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("userId", [userId]),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function ensureCallerIsWorkspaceAdmin({
  endpoint,
  projectId,
  jwt,
  databases,
  databaseId,
  workspaceId,
}) {
  if (!jwt) {
    throw Object.assign(new Error("Missing caller JWT."), { code: 401 });
  }

  const callerClient = buildClient(endpoint, projectId).setJWT(jwt);
  const account = new Account(callerClient);
  const caller = await account.get();
  const callerWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
  if (callerWorkspaceId && callerWorkspaceId !== workspaceId) {
    throw Object.assign(
      new Error("Caller is not allowed to manage another workspace."),
      { code: 403 }
    );
  }

  const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
  if (workspace?.ownerUserId === caller.$id) {
    return caller;
  }

  const membership = await findWorkspaceMembership(
    databases,
    databaseId,
    workspaceId,
    caller.$id
  );
  const role = String(membership?.role ?? "").trim().toLowerCase();
  const status = String(membership?.status ?? "inactive").trim().toLowerCase();

  if (status !== "active" || role !== "admin") {
    throw Object.assign(
      new Error("Only workspace admins can create users and assign roles."),
      { code: 403 }
    );
  }

  return caller;
}

async function upsertWorkspaceMembership({
  databases,
  databaseId,
  workspaceId,
  userId,
  email,
  role,
  actorUserId,
}) {
  const existing = await findWorkspaceMembership(
    databases,
    databaseId,
    workspaceId,
    userId
  );
  if (existing) {
    const updated = await databases.updateDocument(
      databaseId,
      "workspace_memberships",
      existing.$id,
      {
        email: email ?? existing.email ?? null,
        role,
        status: "active",
        invitedByUserId: actorUserId ?? existing.invitedByUserId ?? null,
      }
    );
    return { created: false, document: updated };
  }

  const created = await databases.createDocument(
    databaseId,
    "workspace_memberships",
    ID.unique(),
    {
      workspaceId,
      userId,
      email: email ?? null,
      role,
      status: "active",
      invitedByUserId: actorUserId ?? null,
      notes: null,
    }
  );

  return { created: true, document: created };
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
    const adminClient = buildClient(endpoint, projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const users = new Users(adminClient);

    const caller = await ensureCallerIsWorkspaceAdmin({
      endpoint,
      projectId,
      jwt,
      databases,
      databaseId,
      workspaceId,
    });

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

    const existingMembership = await findWorkspaceMembership(
      databases,
      databaseId,
      workspaceId,
      user.$id
    );
    const existingMembershipActive =
      String(existingMembership?.status ?? "").trim().toLowerCase() === "active";
    const willIncreaseActiveMembers = !existingMembershipActive;
    if (willIncreaseActiveMembers) {
      const subscription = await getLatestSubscription(databases, databaseId, workspaceId);
      const plan = await getPlanByCode(databases, databaseId, subscription?.planCode ?? null);
      const maxTeamMembers = resolvePlanLimit(plan, [
        "maxTeamMembers",
        "teamMembers",
        "max_team_members",
      ]);
      if (maxTeamMembers != null) {
        const activeMembers = await countActiveWorkspaceMembers(
          databases,
          databaseId,
          workspaceId
        );
        if (activeMembers >= maxTeamMembers) {
          return res.json(
            {
              ok: false,
              error:
                "Team member limit reached on your current plan. Upgrade in Settings to add more users.",
            },
            402
          );
        }
      }
    }

    const membershipResult = await upsertWorkspaceMembership({
      databases,
      databaseId,
      workspaceId,
      userId: user.$id,
      email: user.email ?? email,
      role,
      actorUserId: caller.$id,
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
      membership: {
        created: membershipResult.created,
        membershipId: membershipResult.document.$id,
        role: membershipResult.document.role,
        status: membershipResult.document.status,
      },
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
