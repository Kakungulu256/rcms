import { Account, Client, Databases, ID, Query, Teams, Users } from "node-appwrite";

const PLATFORM_SIGNUP_WORKSPACE_ID = "platform";
const SIGNUP_AUDIT_ENTITY_TYPE = "workspace_signup";
const ROLE_TEAM_NAMES = {
  admin: "Admin",
  clerk: "Clerk",
  viewer: "Viewer",
};

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
  return normalizeString(value);
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeJsonString(value, maxLength = 20000) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= maxLength) return json;
  return json.slice(0, maxLength);
}

function resolveTrialDays() {
  const configured = Number(getEnv("RCMS_TRIAL_DAYS"));
  if (!Number.isFinite(configured) || configured <= 0) {
    return 5;
  }
  return Math.floor(configured);
}

function resolveDefaultTrialPlanCode() {
  return getEnv("RCMS_DEFAULT_TRIAL_PLAN_CODE") || "trial";
}

function resolveSignupRateLimit() {
  return {
    maxAttempts: parsePositiveInt(getEnv("RCMS_SIGNUP_MAX_REQUESTS"), 5, 1, 100),
    windowMinutes: parsePositiveInt(getEnv("RCMS_SIGNUP_WINDOW_MINUTES"), 15, 1, 1440),
  };
}

function requireVerifiedEmailForWorkspaceBootstrap() {
  return parseBooleanEnv(
    getEnv(
      "RCMS_REQUIRE_VERIFIED_EMAIL_FOR_WORKSPACE_BOOTSTRAP",
      "APPWRITE_REQUIRE_VERIFIED_EMAIL_FOR_WORKSPACE_BOOTSTRAP"
    ),
    false
  );
}

function addDaysIso(baseDate, days) {
  const next = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

async function writeAuditLog(databases, databaseId, payload) {
  await databases.createDocument(databaseId, "audit_logs", ID.unique(), {
    workspaceId: payload.workspaceId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.action,
    actorId: payload.actorId,
    timestamp: new Date().toISOString(),
    detailsJson: safeJsonString(payload.details ?? null),
  });
}

async function assertSignupRateLimit({
  databases,
  databaseId,
  actorUserId,
  maxAttempts,
  windowMinutes,
}) {
  const page = await databases.listDocuments(databaseId, "audit_logs", [
    Query.equal("workspaceId", [PLATFORM_SIGNUP_WORKSPACE_ID]),
    Query.orderDesc("$createdAt"),
    Query.limit(Math.min(Math.max(maxAttempts * 30, 50), 500)),
  ]);

  const cutoffMs = Date.now() - windowMinutes * 60 * 1000;
  const attempts = (page.documents ?? []).filter((entry) => {
    if (String(entry.entityType ?? "") !== SIGNUP_AUDIT_ENTITY_TYPE) return false;
    if (String(entry.actorId ?? "") !== actorUserId) return false;
    const eventDate = parseDateSafe(entry.timestamp || entry.$createdAt);
    if (!eventDate) return false;
    return eventDate.getTime() >= cutoffMs;
  }).length;

  if (attempts >= maxAttempts) {
    const error = new Error(
      `Signup rate limit reached. Try again in ${windowMinutes} minute(s).`
    );
    error.code = 429;
    throw error;
  }
}

async function findWorkspaceMembership(databases, databaseId, workspaceId, userId) {
  const page = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("userId", [userId]),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function ensureWorkspaceMembership({
  databases,
  databaseId,
  workspaceId,
  userId,
  email,
  role,
  invitedByUserId = null,
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
        invitedByUserId: invitedByUserId ?? existing.invitedByUserId ?? null,
      }
    );
    return { created: false, membershipId: updated.$id, document: updated };
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
      invitedByUserId: invitedByUserId ?? null,
      notes: null,
    }
  );
  return { created: true, membershipId: created.$id, document: created };
}

async function listAllTeamMemberships(teams, teamId) {
  const memberships = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const page = await teams.listMemberships(teamId, [
      Query.limit(pageSize),
      Query.offset(offset),
    ]);
    const items = page.memberships ?? [];
    memberships.push(...items);
    if (items.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return memberships;
}

async function resolveRoleTeamId(teams, role) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const envKeys =
    normalizedRole === "admin"
      ? ["RCMS_APPWRITE_TEAM_ADMIN_ID", "APPWRITE_TEAM_ADMIN_ID"]
      : normalizedRole === "clerk"
        ? ["RCMS_APPWRITE_TEAM_CLERK_ID", "APPWRITE_TEAM_CLERK_ID"]
        : normalizedRole === "viewer"
          ? ["RCMS_APPWRITE_TEAM_VIEWER_ID", "APPWRITE_TEAM_VIEWER_ID"]
          : [];

  const explicitTeamId = getEnv(...envKeys);
  if (explicitTeamId) {
    try {
      const team = await teams.get(explicitTeamId);
      return team.$id;
    } catch {
      // Fall through to name-based lookup.
    }
  }

  const expectedName = ROLE_TEAM_NAMES[normalizedRole];
  if (!expectedName) return null;

  const page = await teams.list([Query.limit(100)]);
  const match = (page.teams ?? []).find(
    (team) => String(team.name ?? "").trim().toLowerCase() === expectedName.toLowerCase()
  );
  return match?.$id ?? null;
}

async function syncUserRoleTeam({ teams, userId, role, log }) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const targetTeamId = await resolveRoleTeamId(teams, normalizedRole);
  if (!targetTeamId) {
    log?.(`bootstrapWorkspace team sync skipped: missing ${normalizedRole} team.`);
    return { synced: false, reason: "missing_target_team" };
  }

  const roleTeamIds = new Map();
  for (const candidateRole of ["admin", "clerk", "viewer"]) {
    const teamId = await resolveRoleTeamId(teams, candidateRole);
    if (teamId) {
      roleTeamIds.set(candidateRole, teamId);
    }
  }

  for (const [candidateRole, teamId] of roleTeamIds.entries()) {
    const memberships = await listAllTeamMemberships(teams, teamId);
    const membership = memberships.find(
      (item) => String(item.userId ?? "").trim() === String(userId ?? "").trim()
    );

    if (candidateRole === normalizedRole) {
      if (!membership) {
        await teams.createMembership(
          teamId,
          ["member"],
          undefined,
          userId,
          undefined,
          undefined,
          `${ROLE_TEAM_NAMES[normalizedRole]} Workspace Access`
        );
      }
      continue;
    }

    if (membership?.$id) {
      await teams.deleteMembership(teamId, membership.$id);
    }
  }

  return { synced: true, teamId: targetTeamId };
}

async function findWorkspaceOwnedByUser(databases, databaseId, userId) {
  const page = await databases.listDocuments(databaseId, "workspaces", [
    Query.equal("ownerUserId", [userId]),
    Query.orderDesc("$updatedAt"),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
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
  const trialPlanCode = resolveDefaultTrialPlanCode();
  const signupRateLimit = resolveSignupRateLimit();
  const requireVerifiedEmail = requireVerifiedEmailForWorkspaceBootstrap();
  const jwt = normalizeString(body.jwt);
  const workspaceName = normalizeString(body.workspaceName);
  const auditContext = {
    callerUserId: null,
    actorId: "bootstrap_workspace",
    workspaceId: PLATFORM_SIGNUP_WORKSPACE_ID,
    entityId: "bootstrap",
  };

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
  if (!jwt) {
    return res.json({ ok: false, error: "Missing caller JWT." }, 401);
  }
  if (!workspaceName) {
    return res.json({ ok: false, error: "Workspace name is required." }, 400);
  }

  try {
    const callerClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
    const callerAccount = new Account(callerClient);
    const caller = await callerAccount.get();
    if (caller?.status === false) {
      return res.json({ ok: false, error: "Caller account is disabled." }, 403);
    }
    if (requireVerifiedEmail && caller?.emailVerification === false) {
      return res.json(
        { ok: false, error: "Verify your email before creating a workspace." },
        403
      );
    }
    const existingWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
    auditContext.callerUserId = caller.$id || null;
    auditContext.actorId = caller.$id || "bootstrap_workspace";
    auditContext.entityId = caller.$id || "bootstrap";

    const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const teams = new Teams(adminClient);
    const users = new Users(adminClient);
    await assertSignupRateLimit({
      databases,
      databaseId,
      actorUserId: caller.$id,
      maxAttempts: signupRateLimit.maxAttempts,
      windowMinutes: signupRateLimit.windowMinutes,
    });

    const ownedWorkspace = await findWorkspaceOwnedByUser(databases, databaseId, caller.$id);
    let workspaceFromPrefs = null;
    if (existingWorkspaceId) {
      workspaceFromPrefs = await databases
        .getDocument(databaseId, "workspaces", existingWorkspaceId)
        .catch(() => null);
    }
    const resolvedWorkspace = workspaceFromPrefs || ownedWorkspace;

    if (resolvedWorkspace) {
      const workspace = resolvedWorkspace;
      if (workspace.ownerUserId === caller.$id) {
        await ensureWorkspaceMembership({
          databases,
          databaseId,
          workspaceId: workspace.$id,
          userId: caller.$id,
          email: caller.email ?? null,
          role: "admin",
          invitedByUserId: caller.$id,
        });
        await syncUserRoleTeam({
          teams,
          userId: caller.$id,
          role: "admin",
          log: logError,
        });
      }
      if (!existingWorkspaceId || existingWorkspaceId !== workspace.$id) {
        await users.updatePrefs(caller.$id, {
          ...(caller.prefs ?? {}),
          workspaceId: workspace.$id,
        });
      }
      let subscriptionDoc = null;
      try {
        const subscriptionPage = await databases.listDocuments(databaseId, "subscriptions", [
          Query.equal("workspaceId", [workspace.$id]),
          Query.limit(1),
        ]);
        subscriptionDoc = subscriptionPage.documents?.[0] ?? null;
      } catch {
        subscriptionDoc = null;
      }
      await writeAuditLog(databases, databaseId, {
        workspaceId: PLATFORM_SIGNUP_WORKSPACE_ID,
        entityType: SIGNUP_AUDIT_ENTITY_TYPE,
        entityId: caller.$id,
        action: "update",
        actorId: caller.$id,
        details: {
          status: "workspace_already_exists",
          resolvedWorkspaceId: workspace.$id,
        },
      });
      return res.json({
        ok: true,
        created: false,
        workspace,
        subscription: {
          state: subscriptionDoc?.state ?? workspace.subscriptionState ?? "trialing",
          trialStartDate: subscriptionDoc?.trialStartDate ?? workspace.trialStartDate ?? null,
          trialEndDate: subscriptionDoc?.trialEndDate ?? workspace.trialEndDate ?? null,
          planCode: subscriptionDoc?.planCode ?? trialPlanCode,
        },
      });
    }

    const now = new Date();
    const trialDays = resolveTrialDays();
    const trialStartDate = now.toISOString();
    const trialEndDate = addDaysIso(now, trialDays);
    const workspace = await databases.createDocument(databaseId, "workspaces", ID.unique(), {
      name: workspaceName,
      ownerUserId: caller.$id,
      status: "active",
      subscriptionState: "trialing",
      trialStartDate,
      trialEndDate,
      prorationMode: "actual_days",
      notes: null,
    });

    let createdSubscription = null;
    try {
      createdSubscription = await databases.createDocument(databaseId, "subscriptions", ID.unique(), {
        workspaceId: workspace.$id,
        planCode: trialPlanCode,
        state: "trialing",
        trialStartDate,
        trialEndDate,
        currentPeriodStart: trialStartDate,
        currentPeriodEnd: trialEndDate,
        pastDueSince: null,
        graceEndsAt: null,
        retryCount: 0,
        nextRetryAt: null,
        lastRetryAt: null,
        dunningStage: null,
        lastFailureReason: null,
        cancelAtPeriodEnd: false,
        notes: "Initial trial subscription",
      });
    } catch (subscriptionError) {
      const subscriptionMessage =
        subscriptionError?.response?.message ??
        subscriptionError?.message ??
        "Failed to create subscription record.";
      logError?.(`bootstrapWorkspace subscription warning: ${subscriptionMessage}`);
    }

    await users.updatePrefs(caller.$id, {
      ...(caller.prefs ?? {}),
      workspaceId: workspace.$id,
    });

    const membership = await ensureWorkspaceMembership({
      databases,
      databaseId,
      workspaceId: workspace.$id,
      userId: caller.$id,
      email: caller.email ?? null,
      role: "admin",
      invitedByUserId: caller.$id,
    });
    await syncUserRoleTeam({
      teams,
      userId: caller.$id,
      role: "admin",
      log: logError,
    });
    await writeAuditLog(databases, databaseId, {
      workspaceId: PLATFORM_SIGNUP_WORKSPACE_ID,
      entityType: SIGNUP_AUDIT_ENTITY_TYPE,
      entityId: caller.$id,
      action: "create",
      actorId: caller.$id,
      details: {
        status: "workspace_created",
        workspaceId: workspace.$id,
        subscriptionState: createdSubscription?.state ?? "trialing",
      },
    });

    return res.json({
      ok: true,
      created: true,
      workspace,
      membership,
      subscription: {
        state: createdSubscription?.state ?? "trialing",
        trialStartDate: createdSubscription?.trialStartDate ?? trialStartDate,
        trialEndDate: createdSubscription?.trialEndDate ?? trialEndDate,
        trialDays,
        planCode: createdSubscription?.planCode ?? trialPlanCode,
      },
    });
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message ??
      error?.message ??
      "Failed to bootstrap workspace.";
    try {
      if (auditContext.callerUserId) {
        const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
        const databases = new Databases(adminClient);
        await writeAuditLog(databases, databaseId, {
          workspaceId: auditContext.workspaceId,
          entityType: SIGNUP_AUDIT_ENTITY_TYPE,
          entityId: auditContext.entityId,
          action: "update",
          actorId: auditContext.actorId,
          details: {
            status: "failed",
            code: status,
            error: message,
          },
        });
      }
    } catch {
      // Ignore audit failures in error path.
    }
    logError?.(`bootstrapWorkspace failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};
