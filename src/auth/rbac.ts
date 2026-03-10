export type AppRole = "admin" | "clerk" | "viewer";

export type RolePermissions = {
  canManageHouses: boolean;
  canViewTenants: boolean;
  canManageTenants: boolean;
  canViewPayments: boolean;
  canRecordPayments: boolean;
  canReversePayments: boolean;
  canRecordExpenses: boolean;
  canUseMigration: boolean;
  canAccessSettings: boolean;
  canViewReports: boolean;
};

const ROLE_PRECEDENCE: AppRole[] = ["admin", "clerk", "viewer"];

const PERMISSIONS: Record<AppRole, RolePermissions> = {
  admin: {
    canManageHouses: true,
    canViewTenants: true,
    canManageTenants: true,
    canViewPayments: true,
    canRecordPayments: true,
    canReversePayments: true,
    canRecordExpenses: true,
    canUseMigration: true,
    canAccessSettings: true,
    canViewReports: true,
  },
  clerk: {
    canManageHouses: true,
    canViewTenants: true,
    canManageTenants: true,
    canViewPayments: true,
    canRecordPayments: true,
    canReversePayments: false,
    canRecordExpenses: true,
    canUseMigration: true,
    canAccessSettings: false,
    canViewReports: true,
  },
  viewer: {
    canManageHouses: false,
    canViewTenants: true,
    canManageTenants: false,
    canViewPayments: true,
    canRecordPayments: false,
    canReversePayments: false,
    canRecordExpenses: false,
    canUseMigration: false,
    canAccessSettings: false,
    canViewReports: true,
  },
};

function normalize(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function roleFromTeamName(teamName: string): AppRole | null {
  const name = normalize(teamName);
  if (name === "admin") return "admin";
  if (name === "clerk") return "clerk";
  if (name === "viewer") return "viewer";
  return null;
}

function roleFromTeamId(teamId: string): AppRole | null {
  const adminId = normalize(
    import.meta.env.VITE_APPWRITE_TEAM_ADMIN_ID as string | undefined
  );
  const clerkId = normalize(
    import.meta.env.VITE_APPWRITE_TEAM_CLERK_ID as string | undefined
  );
  const viewerId = normalize(
    import.meta.env.VITE_APPWRITE_TEAM_VIEWER_ID as string | undefined
  );
  const id = normalize(teamId);
  if (!id) return null;
  if (adminId && id === adminId) return "admin";
  if (clerkId && id === clerkId) return "clerk";
  if (viewerId && id === viewerId) return "viewer";
  return null;
}

export function resolveRoleFromTeams(
  teams: Array<{ $id: string; name?: string }>
): AppRole {
  const roles = new Set<AppRole>();
  teams.forEach((team) => {
    const byId = roleFromTeamId(team.$id);
    const byName = roleFromTeamName(team.name ?? "");
    if (byId) roles.add(byId);
    if (byName) roles.add(byName);
  });
  for (const role of ROLE_PRECEDENCE) {
    if (roles.has(role)) return role;
  }
  return "viewer";
}

export function resolveRoleFromWorkspaceMembership(
  membership:
    | { role?: string | null; status?: string | null }
    | null
    | undefined
): AppRole {
  const status = normalize(membership?.status);
  if (status && status !== "active") {
    return "viewer";
  }
  const role = normalize(membership?.role);
  if (role === "admin") return "admin";
  if (role === "clerk") return "clerk";
  if (role === "viewer") return "viewer";
  return "viewer";
}

export function getRolePermissions(role: AppRole | null | undefined): RolePermissions {
  return PERMISSIONS[role ?? "viewer"];
}
