import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { account, listAllDocuments } from "../lib/appwrite";
import {
  getRolePermissions,
  resolveRoleFromWorkspaceMembership,
  type AppRole,
  type RolePermissions,
} from "./rbac";
import {
  resolveWorkspaceIdFromAccount,
  setActiveWorkspaceId,
} from "../lib/workspace";
import {
  COLLECTIONS,
  type FeatureEntitlement,
  type Plan,
  type Subscription,
  type Workspace,
  type WorkspaceMembership,
} from "../lib/schema";
import { databases, rcmsDatabaseId } from "../lib/appwrite";
import { evaluateBillingSnapshot, type BillingSnapshot } from "../lib/subscriptionLifecycle";
import { parsePlanLimits, type PlanLimits } from "../lib/planLimits";
import {
  buildFeatureEntitlements,
  evaluateFeatureAccess,
  type FeatureAccessDecision,
  type FeatureEntitlementMap,
} from "../lib/entitlements";
import { setDefaultProrationMode } from "../lib/rentHistory";

type AuthUser = {
  id: string;
  name?: string;
  email?: string;
  role: AppRole;
  teamIds: string[];
  workspaceId: string;
  hasWorkspace: boolean;
  billing: BillingSnapshot | null;
  planCode: string | null;
  planLimits: PlanLimits;
  featureEntitlements: FeatureEntitlementMap;
};

type AuthState = {
  user: AuthUser | null;
  role: AppRole | null;
  permissions: RolePermissions;
  billing: BillingSnapshot | null;
  planCode: string | null;
  planLimits: PlanLimits;
  featureEntitlements: FeatureEntitlementMap;
  canAccessFeature: (featureKey: string) => FeatureAccessDecision;
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
  billing: BillingSnapshot | null,
  planCode: string | null,
  planLimits: PlanLimits,
  featureEntitlements: FeatureEntitlementMap
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
    planCode,
    planLimits,
    featureEntitlements,
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
      const workspaceId = setActiveWorkspaceId(workspaceFromPrefs) ?? "";
      const hasWorkspace = Boolean(workspaceFromPrefs);
      let role: AppRole = "viewer";
      const teamIds: string[] = [];
      let billing: BillingSnapshot | null = null;
      let planCode: string | null = null;
      let planLimits = parsePlanLimits(null);
      let featureEntitlements = buildFeatureEntitlements({});

      if (hasWorkspace) {
        try {
          const workspaceDoc = (await databases.getDocument(
            rcmsDatabaseId,
            COLLECTIONS.workspaces,
            workspaceId
          )) as unknown as Workspace;
          setDefaultProrationMode(workspaceDoc?.prorationMode ?? null);
          const subscriptionResult = await databases.listDocuments(
            rcmsDatabaseId,
            COLLECTIONS.subscriptions,
            [Query.equal("workspaceId", [workspaceId]), Query.orderDesc("$updatedAt"), Query.limit(1)]
          );
          const subscriptionDoc =
            (subscriptionResult.documents?.[0] as unknown as Subscription | undefined) ?? null;
          let planDoc: Plan | null = null;
          if (subscriptionDoc?.planCode) {
            const planResult = await databases.listDocuments(rcmsDatabaseId, COLLECTIONS.plans, [
              Query.equal("code", [subscriptionDoc.planCode]),
              Query.limit(1),
            ]);
            planDoc = (planResult.documents?.[0] as unknown as Plan | undefined) ?? null;
          }
          planCode = subscriptionDoc?.planCode ?? planDoc?.code ?? null;
          planLimits = parsePlanLimits(planDoc);
          const membershipResult = await databases
            .listDocuments(rcmsDatabaseId, COLLECTIONS.workspaceMemberships, [
              Query.equal("workspaceId", [workspaceId]),
              Query.equal("userId", [result.$id]),
              Query.equal("status", ["active"]),
              Query.limit(1),
            ])
            .catch(() => null);
          const membership =
            (membershipResult?.documents?.[0] as unknown as WorkspaceMembership | undefined) ??
            null;
          role = resolveRoleFromWorkspaceMembership(membership);
          if (role === "viewer" && workspaceDoc.ownerUserId === result.$id) {
            role = "admin";
          }

          let featureRows: FeatureEntitlement[] = [];
          if (subscriptionDoc?.planCode) {
            featureRows = await listAllDocuments<FeatureEntitlement>({
              databaseId: rcmsDatabaseId,
              collectionId: COLLECTIONS.featureEntitlements,
              queries: [Query.equal("planCode", [subscriptionDoc.planCode])],
              skipWorkspaceScope: true,
            }).catch(() => []);
          }
          featureEntitlements = buildFeatureEntitlements({
            plan: planDoc,
            featureRows,
          });
          billing = evaluateBillingSnapshot({
            workspace: workspaceDoc,
            subscription: subscriptionDoc,
          });
        } catch {
          role = "viewer";
          billing = null;
          planCode = null;
          planLimits = parsePlanLimits(null);
          featureEntitlements = buildFeatureEntitlements({});
          setDefaultProrationMode(null);
        }
      }

      setUser(
        mapUser(
          result,
          role,
          teamIds,
          workspaceId,
          hasWorkspace,
          billing,
          planCode,
          planLimits,
          featureEntitlements
        )
      );
      setError(null);
    } catch (err) {
      setActiveWorkspaceId(null);
      setUser(null);
      setError(null);
      setDefaultProrationMode(null);
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
      setActiveWorkspaceId(null);
      setUser(null);
      setLoading(false);
    }
  }, []);

  const role = user?.role ?? null;
  const permissions = getRolePermissions(role);
  const billing = user?.billing ?? null;
  const planCode = user?.planCode ?? null;
  const planLimits = user?.planLimits ?? parsePlanLimits(null);
  const featureEntitlements = user?.featureEntitlements ?? buildFeatureEntitlements({});
  const canAccessFeature = useCallback(
    (featureKey: string) =>
      evaluateFeatureAccess({
        featureKey,
        billing,
        entitlements: featureEntitlements,
      }),
    [billing, featureEntitlements]
  );

  const value = useMemo(
    () => ({
      user,
      role,
      permissions,
      billing,
      planCode,
      planLimits,
      featureEntitlements,
      canAccessFeature,
      loading,
      error,
      signIn,
      signOut,
      refresh: refreshUser,
    }),
    [
      user,
      role,
      permissions,
      billing,
      planCode,
      planLimits,
      featureEntitlements,
      canAccessFeature,
      loading,
      error,
      signIn,
      signOut,
      refreshUser,
    ]
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
