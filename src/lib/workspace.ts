const WORKSPACE_STORAGE_KEY = "rcms_active_workspace_id";
const DEFAULT_WORKSPACE_ID =
  (import.meta.env.VITE_APPWRITE_DEFAULT_WORKSPACE_ID as string | undefined)?.trim() ||
  "default";

export function normalizeWorkspaceId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function getDefaultWorkspaceId() {
  return DEFAULT_WORKSPACE_ID;
}

export function setActiveWorkspaceId(value?: string | null) {
  const next = normalizeWorkspaceId(value) ?? DEFAULT_WORKSPACE_ID;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
  }
  return next;
}

export function getActiveWorkspaceId() {
  if (typeof window !== "undefined") {
    const stored = normalizeWorkspaceId(window.localStorage.getItem(WORKSPACE_STORAGE_KEY));
    if (stored) return stored;
  }
  return DEFAULT_WORKSPACE_ID;
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
