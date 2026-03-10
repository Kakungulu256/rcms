import { account, functions } from "./appwrite";

type InvitationRole = "admin" | "clerk" | "viewer";
type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type WorkspaceInvitationRecord = {
  $id: string;
  workspaceId?: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  token?: string;
  invitedByUserId?: string | null;
  expiresAt?: string | null;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
  revokedAt?: string | null;
  note?: string | null;
};

type InvitationApiResponse = {
  ok: boolean;
  error?: string;
  invitation?: WorkspaceInvitationRecord;
  invitations?: WorkspaceInvitationRecord[];
  inviteUrl?: string | null;
  emailSent?: boolean;
  workspaceId?: string;
  membership?: {
    membershipId: string;
    role: InvitationRole;
    status: string;
  };
};

type ExecuteParams = {
  payload: Record<string, unknown>;
  authenticated: boolean;
};

function getWorkspaceInvitationsFunctionId() {
  return import.meta.env.VITE_WORKSPACE_INVITATIONS_FUNCTION_ID as
    | string
    | undefined;
}

function readExecutionBody(execution: unknown) {
  return (
    (execution as { responseBody?: string; response?: string }).responseBody ??
    (execution as { responseBody?: string; response?: string }).response ??
    ""
  );
}

function parseExecutionBody(raw: string) {
  try {
    return raw ? (JSON.parse(raw) as InvitationApiResponse) : null;
  } catch {
    return null;
  }
}

async function executeWorkspaceInvitations(params: ExecuteParams) {
  const functionId = getWorkspaceInvitationsFunctionId();
  if (!functionId) {
    return {
      ok: false,
      error: "Workspace invitations function ID is missing.",
    } satisfies InvitationApiResponse;
  }

  const payload = { ...params.payload } as Record<string, unknown>;
  if (params.authenticated) {
    const jwt = await account.createJWT();
    payload.jwt = jwt.jwt;
  }

  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(payload),
    false
  );

  let latest: unknown = execution;
  let body = readExecutionBody(latest);
  let attempts = 0;

  while (
    attempts < 12 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    latest = await functions.getExecution(
      functionId,
      (latest as { $id: string }).$id
    );
    body = readExecutionBody(latest);
    attempts += 1;
  }

  const parsed = parseExecutionBody(body);
  if (parsed) return parsed;
  return {
    ok: false,
    error:
      (latest as { errors?: string }).errors ||
      "Workspace invitations function returned an invalid response.",
  } satisfies InvitationApiResponse;
}

export async function previewWorkspaceInvitation(token: string) {
  return executeWorkspaceInvitations({
    authenticated: false,
    payload: {
      action: "preview",
      token,
    },
  });
}

export async function listWorkspaceInvitations(status?: InvitationStatus) {
  return executeWorkspaceInvitations({
    authenticated: true,
    payload: {
      action: "list",
      ...(status ? { status } : {}),
    },
  });
}

export async function createWorkspaceInvitation(payload: {
  email: string;
  role: InvitationRole;
  note?: string;
  expiresInDays?: number;
}) {
  return executeWorkspaceInvitations({
    authenticated: true,
    payload: {
      action: "create",
      email: payload.email,
      role: payload.role,
      ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
      ...(payload.expiresInDays ? { expiresInDays: payload.expiresInDays } : {}),
    },
  });
}

export async function revokeWorkspaceInvitation(invitationId: string) {
  return executeWorkspaceInvitations({
    authenticated: true,
    payload: {
      action: "revoke",
      invitationId,
    },
  });
}

export async function acceptWorkspaceInvitation(token: string) {
  return executeWorkspaceInvitations({
    authenticated: true,
    payload: {
      action: "accept",
      token,
    },
  });
}
