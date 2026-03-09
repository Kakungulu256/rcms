import crypto from "node:crypto";
import { Account, Client, Databases, ID, Query, Users } from "node-appwrite";

const ALLOWED_ROLES = ["admin", "clerk", "viewer"];
const ALLOWED_STATUSES = ["pending", "accepted", "revoked", "expired"];

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

function normalizeEmail(value) {
  const next = normalizeString(value);
  return next ? next.toLowerCase() : null;
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

function normalizeRole(value) {
  const next = normalizeString(value)?.toLowerCase() ?? null;
  return next && ALLOWED_ROLES.includes(next) ? next : null;
}

function normalizeStatus(value) {
  const next = normalizeString(value)?.toLowerCase() ?? null;
  return next && ALLOWED_STATUSES.includes(next) ? next : null;
}

function resolveWorkspaceId(body) {
  return (
    normalizeWorkspaceId(body?.workspaceId) ||
    normalizeWorkspaceId(getEnv("RCMS_DEFAULT_WORKSPACE_ID")) ||
    "default"
  );
}

function resolveInviteExpiryDays(body) {
  const fromBody = Number(body?.expiresInDays);
  if (Number.isFinite(fromBody) && fromBody >= 1 && fromBody <= 90) {
    return Math.floor(fromBody);
  }
  const fromEnv = Number(getEnv("RCMS_INVITE_EXPIRES_DAYS"));
  if (Number.isFinite(fromEnv) && fromEnv >= 1 && fromEnv <= 90) {
    return Math.floor(fromEnv);
  }
  return 7;
}

function resolveInviteRateLimit() {
  return {
    maxRequests: parsePositiveInt(getEnv("RCMS_INVITE_MAX_REQUESTS"), 20, 1, 200),
    windowMinutes: parsePositiveInt(getEnv("RCMS_INVITE_WINDOW_MINUTES"), 60, 1, 1440),
  };
}

function buildClient(endpoint, projectId) {
  return new Client().setEndpoint(endpoint).setProject(projectId);
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPastDate(value) {
  const parsed = parseDateSafe(value);
  if (!parsed) return false;
  return parsed.getTime() <= Date.now();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function createInviteToken() {
  return `${crypto.randomUUID().replace(/-/g, "")}${Date.now().toString(36)}`;
}

function resolveAppBaseUrl(body) {
  return (
    normalizeString(body?.appBaseUrl) ||
    getEnv("RCMS_APP_BASE_URL") ||
    getEnv("RCMS_BILLING_APP_BASE_URL") ||
    null
  );
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
    typeof row?.enabled === "boolean" ? Boolean(row.enabled) : fromPlan?.enabled ?? true;

  if (!enabled) {
    const error = new Error(
      `Feature "${featureKey}" is locked by your current plan. Upgrade in Settings to continue.`
    );
    error.code = 402;
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

async function findPendingInvitationByEmail(databases, databaseId, workspaceId, email) {
  const page = await databases.listDocuments(databaseId, "workspace_invitations", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("email", [email]),
    Query.equal("status", ["pending"]),
    Query.orderDesc("$updatedAt"),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function findInvitationByToken(databases, databaseId, token) {
  const page = await databases.listDocuments(databaseId, "workspace_invitations", [
    Query.equal("token", [token]),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function findUserByEmail(users, email) {
  const list = await users.list([Query.equal("email", [email]), Query.limit(1)]);
  return list.users.find((item) => item.email?.toLowerCase() === email) ?? null;
}

async function listActiveMembershipsForUser(databases, databaseId, userId) {
  const page = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("userId", [userId]),
    Query.equal("status", ["active"]),
    Query.limit(100),
  ]);
  return page.documents ?? [];
}

async function countActiveWorkspaceMembers(databases, databaseId, workspaceId) {
  const page = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("status", ["active"]),
    Query.limit(1),
  ]);
  return Number(page.total ?? 0);
}

async function assertInviteCreateRateLimit({
  databases,
  databaseId,
  workspaceId,
  actorUserId,
  maxRequests,
  windowMinutes,
}) {
  const page = await databases.listDocuments(databaseId, "workspace_invitations", [
    Query.equal("workspaceId", [workspaceId]),
    Query.orderDesc("$updatedAt"),
    Query.limit(Math.min(Math.max(maxRequests * 20, 80), 500)),
  ]);

  const cutoffMs = Date.now() - windowMinutes * 60 * 1000;
  const attempts = (page.documents ?? []).filter((entry) => {
    if (String(entry.invitedByUserId ?? "") !== actorUserId) return false;
    const timestamp = parseDateSafe(entry.$updatedAt || entry.$createdAt);
    if (!timestamp) return false;
    return timestamp.getTime() >= cutoffMs;
  }).length;

  if (attempts >= maxRequests) {
    const error = new Error(
      `Invitation rate limit reached. Try again in ${windowMinutes} minute(s).`
    );
    error.code = 429;
    throw error;
  }
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
  if (caller?.status === false) {
    throw Object.assign(new Error("Caller account is disabled."), { code: 403 });
  }
  if (caller?.emailVerification === false) {
    throw Object.assign(new Error("Verify your email before managing invitations."), {
      code: 403,
    });
  }
  const callerWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
  if (callerWorkspaceId && callerWorkspaceId !== workspaceId) {
    throw Object.assign(new Error("Caller is not allowed to manage another workspace."), {
      code: 403,
    });
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
    throw Object.assign(new Error("Only workspace admins can manage invitations."), {
      code: 403,
    });
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
  invitedByUserId,
}) {
  const existing = await findWorkspaceMembership(databases, databaseId, workspaceId, userId);
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
      invitedByUserId: invitedByUserId ?? null,
      notes: null,
    }
  );
  return { created: true, document: created };
}

async function sendInviteWebhook(body) {
  const webhookUrl = getEnv("RCMS_INVITE_WEBHOOK_URL");
  if (!webhookUrl) return false;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
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

  const action = normalizeString(body.action)?.toLowerCase() || "create";
  const workspaceId = resolveWorkspaceId(body);
  const jwt = normalizeString(body.jwt);
  const inviteRateLimit = resolveInviteRateLimit();

  try {
    const adminClient = buildClient(endpoint, projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const users = new Users(adminClient);

    if (action === "preview") {
      const token = normalizeString(body.token);
      if (!token) {
        return res.json({ ok: false, error: "Invitation token is required." }, 400);
      }
      const invite = await findInvitationByToken(databases, databaseId, token);
      if (!invite) {
        return res.json({ ok: false, error: "Invitation not found." }, 404);
      }
      if (invite.status === "pending" && isPastDate(invite.expiresAt)) {
        await databases.updateDocument(databaseId, "workspace_invitations", invite.$id, {
          status: "expired",
        });
        invite.status = "expired";
      }
      const workspace = await databases
        .getDocument(databaseId, "workspaces", invite.workspaceId)
        .catch(() => null);

      return res.json({
        ok: true,
        invitation: {
          id: invite.$id,
          workspaceId: invite.workspaceId,
          workspaceName: workspace?.name ?? invite.workspaceId,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt ?? null,
        },
      });
    }

    if (action === "create" || action === "list" || action === "revoke") {
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

      if (action === "list") {
        const status = normalizeStatus(body.status);
        const queries = [Query.equal("workspaceId", [workspaceId]), Query.orderDesc("$updatedAt")];
        if (status) {
          queries.push(Query.equal("status", [status]));
        }
        const page = await databases.listDocuments(databaseId, "workspace_invitations", [
          ...queries,
          Query.limit(100),
        ]);
        return res.json({ ok: true, invitations: page.documents ?? [] });
      }

      if (action === "revoke") {
        const invitationId = normalizeString(body.invitationId);
        if (!invitationId) {
          return res.json({ ok: false, error: "Invitation ID is required." }, 400);
        }
        const invite = await databases.getDocument(
          databaseId,
          "workspace_invitations",
          invitationId
        );
        if (String(invite.workspaceId) !== workspaceId) {
          return res.json({ ok: false, error: "Invitation not in this workspace." }, 403);
        }
        const updated = await databases.updateDocument(
          databaseId,
          "workspace_invitations",
          invitationId,
          {
            status: "revoked",
            revokedAt: new Date().toISOString(),
          }
        );
        return res.json({ ok: true, invitation: updated });
      }

      const email = normalizeEmail(body.email);
      const role = normalizeRole(body.role);
      if (!email) {
        return res.json({ ok: false, error: "Email is required." }, 400);
      }
      if (!role) {
        return res.json({ ok: false, error: "Role must be admin, clerk, or viewer." }, 400);
      }
      await assertInviteCreateRateLimit({
        databases,
        databaseId,
        workspaceId,
        actorUserId: caller.$id,
        maxRequests: inviteRateLimit.maxRequests,
        windowMinutes: inviteRateLimit.windowMinutes,
      });

      const existingUser = await findUserByEmail(users, email);
      if (existingUser) {
        const existingMembership = await findWorkspaceMembership(
          databases,
          databaseId,
          workspaceId,
          existingUser.$id
        );
        if (existingMembership?.status === "active") {
          return res.json(
            { ok: false, error: "User already has an active membership in this workspace." },
            409
          );
        }
      }

      const token = createInviteToken();
      const expiresAt = addDaysIso(resolveInviteExpiryDays(body));
      const pending = await findPendingInvitationByEmail(
        databases,
        databaseId,
        workspaceId,
        email
      );

      const payload = {
        email,
        role,
        status: "pending",
        token,
        invitedByUserId: caller.$id,
        expiresAt,
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
        note: normalizeString(body.note) ?? null,
      };

      const invitation = pending
        ? await databases.updateDocument(
            databaseId,
            "workspace_invitations",
            pending.$id,
            payload
          )
        : await databases.createDocument(
            databaseId,
            "workspace_invitations",
            ID.unique(),
            { workspaceId, ...payload }
          );

      const appBaseUrl = resolveAppBaseUrl(body);
      const inviteUrl = appBaseUrl
        ? `${appBaseUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`
        : null;
      const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
      const emailSent = inviteUrl
        ? await sendInviteWebhook({
            type: "workspace_invitation",
            toEmail: email,
            role,
            workspaceName: workspace?.name ?? workspaceId,
            inviteUrl,
            expiresAt,
          })
        : false;

      return res.json({
        ok: true,
        invitation,
        inviteUrl,
        emailSent,
      });
    }

    if (action === "accept") {
      const token = normalizeString(body.token);
      if (!token) {
        return res.json({ ok: false, error: "Invitation token is required." }, 400);
      }
      if (!jwt) {
        return res.json({ ok: false, error: "Sign in to accept invitation." }, 401);
      }

      const invite = await findInvitationByToken(databases, databaseId, token);
      if (!invite) {
        return res.json({ ok: false, error: "Invitation not found." }, 404);
      }
      if (invite.status !== "pending") {
        return res.json({ ok: false, error: `Invitation is ${invite.status}.` }, 409);
      }
      if (isPastDate(invite.expiresAt)) {
        await databases.updateDocument(databaseId, "workspace_invitations", invite.$id, {
          status: "expired",
        });
        return res.json({ ok: false, error: "Invitation has expired." }, 410);
      }

      const callerClient = buildClient(endpoint, projectId).setJWT(jwt);
      const account = new Account(callerClient);
      const caller = await account.get();
      if (caller?.status === false) {
        return res.json({ ok: false, error: "Caller account is disabled." }, 403);
      }
      if (caller?.emailVerification === false) {
        return res.json(
          { ok: false, error: "Verify your email before accepting invitations." },
          403
        );
      }
      const callerEmail = normalizeEmail(caller.email);
      if (!callerEmail || callerEmail !== normalizeEmail(invite.email)) {
        return res.json(
          { ok: false, error: "Invitation email does not match signed-in account." },
          403
        );
      }

      const activeMemberships = await listActiveMembershipsForUser(
        databases,
        databaseId,
        caller.$id
      );
      const foreignMembership = activeMemberships.find(
        (membership) => String(membership.workspaceId ?? "") !== String(invite.workspaceId ?? "")
      );
      if (foreignMembership) {
        return res.json(
          {
            ok: false,
            error:
              "This user already has an active membership in another workspace. Conflicting memberships are not allowed.",
          },
          409
        );
      }

      const subscription = await getLatestSubscription(
        databases,
        databaseId,
        invite.workspaceId
      );
      const plan = await getPlanByCode(databases, databaseId, subscription?.planCode ?? null);
      const maxTeamMembers = resolvePlanLimit(plan, [
        "maxTeamMembers",
        "teamMembers",
        "max_team_members",
      ]);
      const existingMembership = await findWorkspaceMembership(
        databases,
        databaseId,
        invite.workspaceId,
        caller.$id
      );
      const existingMembershipActive =
        String(existingMembership?.status ?? "").trim().toLowerCase() === "active";
      if (!existingMembershipActive && maxTeamMembers != null) {
        const activeCount = await countActiveWorkspaceMembers(
          databases,
          databaseId,
          invite.workspaceId
        );
        if (activeCount >= maxTeamMembers) {
          return res.json(
            {
              ok: false,
              error:
                "Workspace team member limit reached. Ask workspace admin to upgrade the plan.",
            },
            402
          );
        }
      }

      const existingWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
      if (existingWorkspaceId && existingWorkspaceId !== invite.workspaceId) {
        return res.json(
          {
            ok: false,
            error:
              "Your account is linked to another workspace. Conflicting memberships are not allowed.",
          },
          409
        );
      }

      const membership = await upsertWorkspaceMembership({
        databases,
        databaseId,
        workspaceId: invite.workspaceId,
        userId: caller.$id,
        email: caller.email ?? invite.email,
        role: normalizeRole(invite.role) ?? "viewer",
        invitedByUserId: invite.invitedByUserId ?? null,
      });

      await users.updatePrefs({
        userId: caller.$id,
        prefs: {
          ...(caller.prefs ?? {}),
          workspaceId: invite.workspaceId,
        },
      });

      const accepted = await databases.updateDocument(
        databaseId,
        "workspace_invitations",
        invite.$id,
        {
          status: "accepted",
          acceptedAt: new Date().toISOString(),
          acceptedByUserId: caller.$id,
        }
      );

      return res.json({
        ok: true,
        invitation: accepted,
        membership: {
          membershipId: membership.document.$id,
          role: membership.document.role,
          status: membership.document.status,
        },
        workspaceId: invite.workspaceId,
      });
    }

    return res.json({ ok: false, error: "Unsupported action." }, 400);
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message ?? error?.message ?? "Failed to process invitation request.";
    logError?.(`workspaceInvitations failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};
