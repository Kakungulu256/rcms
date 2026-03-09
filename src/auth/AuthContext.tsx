import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { account, teams } from "../lib/appwrite";
import { getRolePermissions, resolveRoleFromTeams, type AppRole, type RolePermissions } from "./rbac";
import {
  resolveWorkspaceIdFromAccount,
  setActiveWorkspaceId,
} from "../lib/workspace";
import { COLLECTIONS, type Subscription, type Workspace } from "../lib/schema";
import { databases, rcmsDatabaseId } from "../lib/appwrite";
import { evaluateBillingSnapshot, type BillingSnapshot } from "../lib/subscriptionLifecycle";

type AuthUser = {
  id: string;
  name?: string;
  email?: string;
  role: AppRole;
  teamIds: string[];
  workspaceId: string;
  hasWorkspace: boolean;
  billing: BillingSnapshot | null;
};

type AuthState = {
  user: AuthUser | null;
  role: AppRole | null;
  permissions: RolePermissions;
  billing: BillingSnapshot | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function mapUser(
  user: { $id: string; name?: string; email?: string },
  role: AppRole,
  teamIds: string[],
  workspaceId: string,
  hasWorkspace: boolean,
  billing: BillingSnapshot | null
): AuthUser {
  return {
    id: user.$id,
    name: user.name,
    email: user.email,
    role,
    teamIds,
    workspaceId,
    hasWorkspace,
    billing,
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
      const workspaceFromPrefs = resolveWorkspaceIdFromAccount(
        result as unknown as { prefs?: Record<string, unknown> }
      );
      const workspaceId = setActiveWorkspaceId(workspaceFromPrefs);
      const hasWorkspace = Boolean(workspaceFromPrefs);
      let role: AppRole = "viewer";
      let teamIds: string[] = [];
      let billing: BillingSnapshot | null = null;
      try {
        const teamResult = await teams.list();
        const teamList = teamResult.teams ?? [];
        teamIds = teamList.map((team) => team.$id);
        role = resolveRoleFromTeams(teamList);
      } catch {
        role = "viewer";
      }

      if (hasWorkspace) {
        try {
          const workspaceDoc = (await databases.getDocument(
            rcmsDatabaseId,
            COLLECTIONS.workspaces,
            workspaceId
          )) as unknown as Workspace;
          const subscriptionResult = await databases.listDocuments(
            rcmsDatabaseId,
            COLLECTIONS.subscriptions,
            [Query.equal("workspaceId", [workspaceId]), Query.orderDesc("$updatedAt"), Query.limit(1)]
          );
          const subscriptionDoc =
            (subscriptionResult.documents?.[0] as unknown as Subscription | undefined) ?? null;
          billing = evaluateBillingSnapshot({
            workspace: workspaceDoc,
            subscription: subscriptionDoc,
          });
        } catch {
          billing = null;
        }
      }

      setUser(mapUser(result, role, teamIds, workspaceId, hasWorkspace, billing));
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
  const billing = user?.billing ?? null;

  const value = useMemo(
    () => ({
      user,
      role,
      permissions,
      billing,
      loading,
      error,
      signIn,
      signOut,
      refresh: refreshUser,
    }),
    [user, role, permissions, billing, loading, error, signIn, signOut, refreshUser]
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
