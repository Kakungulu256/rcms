import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { account, teams } from "../lib/appwrite";
import { getRolePermissions, resolveRoleFromTeams, type AppRole, type RolePermissions } from "./rbac";

type AuthUser = {
  id: string;
  name?: string;
  email?: string;
  role: AppRole;
  teamIds: string[];
};

type AuthState = {
  user: AuthUser | null;
  role: AppRole | null;
  permissions: RolePermissions;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function mapUser(
  user: { $id: string; name?: string; email?: string },
  role: AppRole,
  teamIds: string[]
): AuthUser {
  return {
    id: user.$id,
    name: user.name,
    email: user.email,
    role,
    teamIds,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      const result = await account.get();
      let role: AppRole = "viewer";
      let teamIds: string[] = [];
      try {
        const teamResult = await teams.list();
        const teamList = teamResult.teams ?? [];
        teamIds = teamList.map((team) => team.$id);
        role = resolveRoleFromTeams(teamList);
      } catch {
        role = "viewer";
      }
      setUser(mapUser(result, role, teamIds));
      setError(null);
    } catch (err) {
      setUser(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await account.createEmailPasswordSession(email, password);
      await refreshUser();
      return true;
    } catch (err) {
      setError("Invalid email or password.");
      setLoading(false);
      return false;
    }
  }, [refreshUser]);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await account.deleteSession("current");
    } finally {
      setUser(null);
      setLoading(false);
    }
  }, []);

  const role = user?.role ?? null;
  const permissions = getRolePermissions(role);

  const value = useMemo(
    () => ({
      user,
      role,
      permissions,
      loading,
      error,
      signIn,
      signOut,
    }),
    [user, role, permissions, loading, error, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
