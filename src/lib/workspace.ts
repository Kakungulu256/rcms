const WORKSPACE_STORAGE_KEY = "rcms_active_workspace_id";
let activeWorkspaceId: string | null = null;

export function normalizeWorkspaceId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function setActiveWorkspaceId(value?: string | null) {
  const next = normalizeWorkspaceId(value);
  activeWorkspaceId = next;
  if (typeof window !== "undefined") {
    if (next) {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
    } else {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  }
  return next;
}

export function getActiveWorkspaceId() {
  return activeWorkspaceId;
}

export function getRequiredActiveWorkspaceId() {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) {
    throw new Error("Active workspace is not set.");
  }
  return workspaceId;
}

export function resolveWorkspaceIdFromAccount(
  accountData: { prefs?: Record<string, unknown> } | null | undefined
) {
  const prefsValue = accountData?.prefs?.workspaceId;
  if (typeof prefsValue === "string") {
    return normalizeWorkspaceId(prefsValue);
  }
  return null;
}
