type PlatformIdentity = {
  id: string;
  email?: string | null;
};

function parseCsvEnv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const OWNER_EMAILS = parseCsvEnv(
  import.meta.env.VITE_PLATFORM_OWNER_EMAILS as string | undefined
).map((email) => email.toLowerCase());

const OWNER_USER_IDS = parseCsvEnv(
  import.meta.env.VITE_PLATFORM_OWNER_USER_IDS as string | undefined
);

export function isPlatformOwnerUser(user?: PlatformIdentity | null) {
  if (!user) return false;
  const hasConfig = OWNER_EMAILS.length > 0 || OWNER_USER_IDS.length > 0;
  if (!hasConfig) return false;

  const userId = String(user.id ?? "").trim();
  const userEmail = String(user.email ?? "")
    .trim()
    .toLowerCase();

  if (userId && OWNER_USER_IDS.includes(userId)) {
    return true;
  }
  if (userEmail && OWNER_EMAILS.includes(userEmail)) {
    return true;
  }
  return false;
}

export function getPlatformOwnerConfigSummary() {
  return {
    ownerEmailsConfigured: OWNER_EMAILS.length,
    ownerUserIdsConfigured: OWNER_USER_IDS.length,
  };
}
