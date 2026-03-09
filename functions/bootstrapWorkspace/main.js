import { Account, Client, Databases, ID, Query, Teams, Users } from "node-appwrite";

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

function addDaysIso(baseDate, days) {
  const next = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

async function findTeamByName(teams, expectedName) {
  const normalizedExpected = String(expectedName).trim().toLowerCase();
  const page = await teams.list([Query.limit(100)]);
  return (
    (page.teams ?? []).find(
      (team) => String(team.name ?? "").trim().toLowerCase() === normalizedExpected
    ) ?? null
  );
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

async function ensureTeamMembership(teams, teamId, userId, name) {
  const existing = await listMembershipsForUser(teams, teamId, userId);
  if (existing.length > 0) {
    return { created: false, membershipId: existing[0].$id };
  }
  const created = await teams.createMembership({
    teamId,
    roles: ["member"],
    userId,
    name,
  });
  return { created: true, membershipId: created.$id };
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
  const configuredAdminTeamId = getEnv("RCMS_APPWRITE_TEAM_ADMIN_ID", "APPWRITE_TEAM_ADMIN_ID");
  const trialPlanCode = resolveDefaultTrialPlanCode();
  const jwt = normalizeString(body.jwt);
  const workspaceName = normalizeString(body.workspaceName);

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
    const existingWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);

    const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const users = new Users(adminClient);
    const teams = new Teams(adminClient);

    if (existingWorkspaceId) {
      const workspace = await databases.getDocument(databaseId, "workspaces", existingWorkspaceId);
      let subscriptionDoc = null;
      try {
        const subscriptionPage = await databases.listDocuments(databaseId, "subscriptions", [
          Query.equal("workspaceId", [existingWorkspaceId]),
          Query.limit(1),
        ]);
        subscriptionDoc = subscriptionPage.documents?.[0] ?? null;
      } catch {
        subscriptionDoc = null;
      }
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

    let adminTeamId = configuredAdminTeamId;
    if (!adminTeamId) {
      const adminTeam = await findTeamByName(teams, "admin");
      adminTeamId = adminTeam?.$id ?? null;
    }
    if (!adminTeamId) {
      return res.json(
        {
          ok: false,
          error: "Admin team is not configured. Set RCMS_APPWRITE_TEAM_ADMIN_ID.",
        },
        500
      );
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

    await users.updatePrefs({
      userId: caller.$id,
      prefs: {
        ...(caller.prefs ?? {}),
        workspaceId: workspace.$id,
      },
    });

    const membership = await ensureTeamMembership(
      teams,
      adminTeamId,
      caller.$id,
      caller.name ?? "Workspace Admin"
    );

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
    logError?.(`bootstrapWorkspace failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};
