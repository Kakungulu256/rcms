import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ID, Query } from "appwrite";
import { Link, useSearchParams } from "react-router-dom";
import {
  account,
  createWorkspaceDocument,
  databases,
  functions,
  listAllDocuments,
  rcmsReceiptsBucketId,
  rcmsDatabaseId,
  storage,
} from "../../lib/appwrite";
import { useToast } from "../ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { logAudit } from "../../lib/audit";
import { getActiveWorkspaceId } from "../../lib/workspace";
import { createBillingCheckoutSession } from "../../lib/billing";
import { formatDisplayDate } from "../../lib/dateDisplay";
import {
  COLLECTIONS,
  type BillingPayment,
  type Invoice,
  type Plan,
  type Subscription,
  type Workspace,
  type WorkspaceMembership,
} from "../../lib/schema";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";
import {
  ALLOWED_BRANDING_MIME_TYPES,
  MAX_BRANDING_FILE_SIZE_BYTES,
  WATERMARK_POSITIONS,
  type WatermarkPosition,
  type WorkspaceBranding,
  clampWatermarkOpacity,
  clampWatermarkScale,
  normalizeWorkspaceBranding,
} from "../../lib/branding";
import WorkspaceInvitationsPanel from "../settings/WorkspaceInvitationsPanel";

type AppRole = "admin" | "clerk" | "viewer";
type SettingsTab = "billing" | "branding" | "team";
type BillingAction = "cancel" | "reactivate";

type ManageUserSuccess = {
  ok: true;
  created: boolean;
  role: AppRole;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type ManageUserFailure = {
  ok: false;
  error?: string;
};

type ManageUserResult = ManageUserSuccess | ManageUserFailure;

function parseExecutionBody(response?: string) {
  try {
    return response ? (JSON.parse(response) as ManageUserResult) : null;
  } catch {
    return null;
  }
}

function formatMoney(amount: number | undefined, currency = "UGX") {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `0 ${currency}`;
  return `${value.toLocaleString()} ${currency}`;
}

function getFileViewUrl(bucketId: string, fileId: string) {
  try {
    const result = storage.getFileView(bucketId, fileId) as unknown;
    if (typeof result === "string") return result;
    if (result && typeof (result as URL).toString === "function") {
      return (result as URL).toString();
    }
    return null;
  } catch {
    return null;
  }
}

async function executeManageUsersFunction(
  functionId: string,
  payload: Record<string, unknown>
) {
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(payload),
    false
  );

  const readBody = (value: unknown) =>
    (value as { responseBody?: string; response?: string }).responseBody ??
    (value as { responseBody?: string; response?: string }).response ??
    "";

  let latest: unknown = execution;
  let body = readBody(latest);
  let attempts = 0;

  while (
    attempts < 8 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    latest = await functions.getExecution(
      functionId,
      (latest as { $id: string }).$id
    );
    body = readBody(latest);
    attempts += 1;
  }

  return {
    parsed: parseExecutionBody(body),
    latest: latest as { errors?: string },
  };
}

export default function SettingsPage() {
  const { user, billing, canAccessFeature, planLimits, refresh } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ManageUserSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [teamMemberCount, setTeamMemberCount] = useState(0);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billingPayments, setBillingPayments] = useState<BillingPayment[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingActionLoading, setBillingActionLoading] =
    useState<BillingAction | null>(null);
  const [workspaceDoc, setWorkspaceDoc] = useState<Workspace | null>(null);
  const [branding, setBranding] = useState<WorkspaceBranding>(() =>
    normalizeWorkspaceBranding(null)
  );
  const [brandingPreviewUrl, setBrandingPreviewUrl] = useState<string | null>(null);
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingFile, setBrandingFile] = useState<File | null>(null);

  const activeWorkspaceId = getActiveWorkspaceId();
  const manageUsersFunctionId = import.meta.env.VITE_MANAGE_USERS_FUNCTION_ID as
    | string
    | undefined;
  const manageUsersAccess = canAccessFeature("settings.manage_users");
  const teamMemberLimitStatus = getLimitStatus(planLimits.maxTeamMembers, teamMemberCount);

  const currentTab = (searchParams.get("tab") || "billing").toLowerCase();
  const activeTab: SettingsTab =
    currentTab === "team" ? "team" : currentTab === "branding" ? "branding" : "billing";

  const latestPayment = useMemo(() => {
    const preferred =
      billingPayments.find((entry) => entry.status === "succeeded") ?? null;
    return preferred ?? billingPayments[0] ?? null;
  }, [billingPayments]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === planCode) ?? null,
    [plans, planCode]
  );
  const currentPlan = useMemo(
    () => plans.find((plan) => plan.code === (subscription?.planCode ?? billing?.planCode)) ?? null,
    [billing?.planCode, plans, subscription?.planCode]
  );

  const renewalDate =
    subscription?.currentPeriodEnd ??
    subscription?.trialEndDate ??
    billing?.trialEndDate ??
    null;

  const canCancelSubscription = Boolean(
    subscription &&
      ["trialing", "active", "past_due"].includes(subscription.state) &&
      !subscription.cancelAtPeriodEnd
  );
  const canReactivateSubscription = Boolean(
    subscription && (subscription.cancelAtPeriodEnd || subscription.state === "canceled")
  );

  const setTab = (tab: SettingsTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const loadBillingData = async () => {
    setBillingLoading(true);
    setBillingError(null);
    setBrandingLoading(true);
    try {
      const [subscriptionRows, invoiceRows, paymentRows, workspace] = await Promise.all([
        listAllDocuments<Subscription>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.subscriptions,
          queries: [Query.orderDesc("$updatedAt")],
        }),
        listAllDocuments<Invoice>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.invoices,
          queries: [Query.orderDesc("$updatedAt")],
        }),
        listAllDocuments<BillingPayment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.paymentsBilling,
          queries: [Query.orderDesc("$updatedAt")],
        }),
        databases
          .getDocument(rcmsDatabaseId, COLLECTIONS.workspaces, activeWorkspaceId)
          .then((doc) => doc as unknown as Workspace)
          .catch(() => null),
      ]);
      const latestSubscription = subscriptionRows[0] ?? null;
      setSubscription(latestSubscription);
      setInvoices(invoiceRows.slice(0, 25));
      setBillingPayments(paymentRows.slice(0, 25));
      setPlanCode((current) => current || latestSubscription?.planCode || "");
      setWorkspaceDoc(workspace);
      const normalizedBranding = normalizeWorkspaceBranding(workspace);
      setBranding(normalizedBranding);
      if (normalizedBranding.logoFileId) {
        setBrandingPreviewUrl(
          getFileViewUrl(
            normalizedBranding.logoBucketId || rcmsReceiptsBucketId,
            normalizedBranding.logoFileId
          )
        );
      } else {
        setBrandingPreviewUrl(null);
      }
    } catch (loadError) {
      setBillingError("Failed to load billing settings.");
      setSubscription(null);
      setInvoices([]);
      setBillingPayments([]);
      setWorkspaceDoc(null);
      setBranding(normalizeWorkspaceBranding(null));
      setBrandingPreviewUrl(null);
    } finally {
      setBillingLoading(false);
      setBrandingLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      try {
        const response = await databases.listDocuments(rcmsDatabaseId, COLLECTIONS.plans, [
          Query.equal("isActive", [true]),
          Query.orderAsc("sortOrder"),
          Query.limit(20),
        ]);
        const docs = response.documents as unknown as Plan[];
        if (!active) return;
        setPlans(docs);
        setPlanCode((current) => current || docs[0]?.code || "");
      } catch {
        if (active) {
          setPlans([]);
        }
      }
    };
    void loadPlans();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadTeamUsage = async () => {
      try {
        const rows = await listAllDocuments<WorkspaceMembership>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.workspaceMemberships,
          queries: [Query.equal("status", ["active"])],
        });
        if (!active) return;
        setTeamMemberCount(rows.length);
      } catch {
        if (active) {
          setTeamMemberCount(0);
        }
      }
    };
    void loadTeamUsage();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadBillingData();
  }, []);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("viewer");
  };

  const handleStartCheckout = async (forcedPlanCode?: string) => {
    const checkoutPlanCode = (forcedPlanCode || planCode).trim();
    if (!checkoutPlanCode) {
      toast.push("warning", "Select a plan before continuing.");
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await createBillingCheckoutSession({
        workspaceId: activeWorkspaceId,
        planCode: checkoutPlanCode,
        couponCode: couponCode.trim() || undefined,
      });
      if (!result.ok) {
        throw new Error(result.error || "Failed to start billing checkout.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      const message =
        checkoutError instanceof Error
          ? checkoutError.message
          : "Failed to start billing checkout.";
      toast.push("error", message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleBillingAction = async (action: BillingAction) => {
    if (!subscription) {
      toast.push("warning", "No active subscription record found.");
      return;
    }

    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel subscription at period end? Access stays until renewal date, then premium features lock."
      )
    ) {
      return;
    }

    if (
      action === "reactivate" &&
      !window.confirm(
        "Reactivate this subscription now and restore normal access state?"
      )
    ) {
      return;
    }

    setBillingActionLoading(action);
    try {
      const nowIso = new Date().toISOString();
      const previousState = subscription.state;
      const patch =
        action === "cancel"
          ? {
              state: "canceled" as const,
              cancelAtPeriodEnd: true,
              canceledAt: nowIso,
              endedAt: null,
              graceEndsAt: subscription.graceEndsAt ?? subscription.currentPeriodEnd ?? null,
              notes: "Cancellation requested by workspace admin from settings.",
            }
          : {
              state: "active" as const,
              cancelAtPeriodEnd: false,
              canceledAt: null,
              endedAt: null,
              graceEndsAt: null,
              retryCount: 0,
              nextRetryAt: null,
              lastRetryAt: null,
              dunningStage: null,
              lastFailureReason: null,
              notes: "Reactivated by workspace admin from settings.",
            };

      const updated = (await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.subscriptions,
        subscription.$id,
        patch
      )) as unknown as Subscription;

      await databases
        .updateDocument(rcmsDatabaseId, COLLECTIONS.workspaces, activeWorkspaceId, {
          subscriptionState: updated.state,
        })
        .catch(() => null);

      await createWorkspaceDocument({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.subscriptionEvents,
        data: {
          subscriptionId: updated.$id,
          eventType:
            action === "cancel"
              ? "subscription_cancel_requested"
              : "subscription_reactivated",
          eventSource: "settings_ui",
          eventTime: nowIso,
          stateFrom: previousState,
          stateTo: updated.state,
          idempotencyKey: `settings_${action}_${updated.$id}_${Date.now()}`,
          payloadJson: JSON.stringify({ action, actorUserId: user?.id ?? null }),
          actorUserId: user?.id ?? null,
          reference: updated.$id,
        },
      }).catch(() => null);

      if (user) {
        void logAudit({
          entityType: "subscription",
          entityId: updated.$id,
          action: "update",
          actorId: user.id,
          details: {
            action,
            previousState,
            nextState: updated.state,
            cancelAtPeriodEnd: updated.cancelAtPeriodEnd ?? false,
          },
        });
      }

      toast.push(
        "success",
        action === "cancel"
          ? "Subscription marked to cancel at period end."
          : "Subscription reactivated."
      );
      await loadBillingData();
      await refresh();
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : "Failed to update subscription.";
      toast.push("error", message);
    } finally {
      setBillingActionLoading(null);
    }
  };

  const handleSaveBranding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspaceDoc) {
      toast.push("warning", "Workspace record not found.");
      return;
    }

    setBrandingSaving(true);
    try {
      let nextLogoFileId = branding.logoFileId;
      let nextLogoFileName = branding.logoFileName;
      let nextLogoBucketId = branding.logoBucketId || rcmsReceiptsBucketId;
      const previousLogoFileId = workspaceDoc.logoFileId?.trim() || null;
      const previousLogoBucketId =
        workspaceDoc.logoBucketId?.trim() || rcmsReceiptsBucketId;

      if (brandingFile) {
        if (!ALLOWED_BRANDING_MIME_TYPES.has(brandingFile.type)) {
          throw new Error("Logo must be PNG, JPG, or WEBP.");
        }
        if (brandingFile.size > MAX_BRANDING_FILE_SIZE_BYTES) {
          throw new Error("Logo file must be 2MB or smaller.");
        }

        const uploaded = await storage.createFile(
          rcmsReceiptsBucketId,
          ID.unique(),
          brandingFile
        );
        nextLogoFileId = uploaded.$id;
        nextLogoFileName = uploaded.name || brandingFile.name;
        nextLogoBucketId = rcmsReceiptsBucketId;
      }

      const payload = {
        logoFileId: nextLogoFileId,
        logoBucketId: nextLogoFileId ? nextLogoBucketId : null,
        logoFileName: nextLogoFileId ? nextLogoFileName : null,
        wmEnabled: Boolean(branding.wmEnabled),
        wmPosition: branding.wmPosition,
        wmOpacity: clampWatermarkOpacity(branding.wmOpacity),
        wmScale: clampWatermarkScale(branding.wmScale),
      };

      const updatedWorkspace = (await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.workspaces,
        workspaceDoc.$id,
        payload
      )) as unknown as Workspace;

      if (
        previousLogoFileId &&
        previousLogoFileId !== payload.logoFileId &&
        previousLogoBucketId
      ) {
        await storage.deleteFile(previousLogoBucketId, previousLogoFileId).catch(() => null);
      }

      setWorkspaceDoc(updatedWorkspace);
      setBranding(normalizeWorkspaceBranding(updatedWorkspace));
      setBrandingFile(null);
      if (updatedWorkspace.logoFileId) {
        setBrandingPreviewUrl(
          getFileViewUrl(
            updatedWorkspace.logoBucketId || rcmsReceiptsBucketId,
            updatedWorkspace.logoFileId
          )
        );
      } else {
        setBrandingPreviewUrl(null);
      }

      if (user) {
        void logAudit({
          entityType: "workspace_branding",
          entityId: workspaceDoc.$id,
          action: "update",
          actorId: user.id,
          details: payload,
        });
      }
      toast.push("success", "Workspace branding saved.");
    } catch (saveError) {
      toast.push(
        "error",
        saveError instanceof Error ? saveError.message : "Failed to save branding."
      );
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!workspaceDoc || !workspaceDoc.logoFileId) {
      setBranding((prev) => ({
        ...prev,
        logoFileId: null,
        logoBucketId: null,
        logoFileName: null,
        wmEnabled: false,
      }));
      setBrandingFile(null);
      setBrandingPreviewUrl(null);
      return;
    }

    if (!window.confirm("Remove the current company logo?")) {
      return;
    }

    setBrandingSaving(true);
    try {
      await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.workspaces,
        workspaceDoc.$id,
        {
          logoFileId: null,
          logoBucketId: null,
          logoFileName: null,
          wmEnabled: false,
        }
      );
      await storage
        .deleteFile(
          workspaceDoc.logoBucketId || rcmsReceiptsBucketId,
          workspaceDoc.logoFileId
        )
        .catch(() => null);
      setBranding((prev) => ({
        ...prev,
        logoFileId: null,
        logoBucketId: null,
        logoFileName: null,
        wmEnabled: false,
      }));
      setBrandingFile(null);
      setBrandingPreviewUrl(null);
      await loadBillingData();
      toast.push("success", "Company logo removed.");
    } catch {
      toast.push("error", "Failed to remove company logo.");
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    if (!manageUsersAccess.allowed) {
      const reason =
        manageUsersAccess.reason ||
        "User management is locked on your current plan.";
      setError(reason);
      toast.push("warning", reason);
      return;
    }

    if (!manageUsersFunctionId) {
      setError("Manage users function ID is missing.");
      toast.push("warning", "Manage users function ID is missing.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      toast.push("warning", "Email is required.");
      return;
    }

    if (password.trim().length > 0 && password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      toast.push("warning", "Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const jwt = await account.createJWT();
      const { parsed, latest } = await executeManageUsersFunction(manageUsersFunctionId, {
        jwt: jwt.jwt,
        workspaceId: activeWorkspaceId,
        name: name.trim() || null,
        email: normalizedEmail,
        password: password.trim() || null,
        role,
      });

      if (!parsed || !parsed.ok) {
        throw new Error(parsed?.error || latest?.errors || "Failed to manage user.");
      }

      setResult(parsed);
      setPassword("");
      resetForm();
      if (parsed.created) {
        setTeamMemberCount((prev) => prev + 1);
      }
      toast.push(
        "success",
        parsed.created
          ? "User created and role assigned."
          : "User role assignment updated."
      );

      if (user) {
        void logAudit({
          entityType: "user",
          entityId: parsed.user.id,
          action: parsed.created ? "create" : "update",
          actorId: user.id,
          details: {
            email: parsed.user.email,
            role: parsed.role,
            created: parsed.created,
          },
        });
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to create or update user.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Settings</div>
        <h3 className="mt-3 text-2xl font-semibold text-white">Workspace Settings</h3>
        <p className="mt-2 text-sm text-slate-400">
          Manage billing lifecycle and team permissions.
        </p>
      </header>

      <div
        className="rounded-2xl border p-2"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("billing")}
            className={[
              "rounded-xl px-4 py-2 text-sm transition",
              activeTab === "billing"
                ? "bg-blue-600 text-white"
                : "border text-slate-300 hover:bg-slate-900/50",
            ].join(" ")}
            style={activeTab === "billing" ? undefined : { borderColor: "var(--border)" }}
          >
            Billing
          </button>
          <button
            type="button"
            onClick={() => setTab("branding")}
            className={[
              "rounded-xl px-4 py-2 text-sm transition",
              activeTab === "branding"
                ? "bg-blue-600 text-white"
                : "border text-slate-300 hover:bg-slate-900/50",
            ].join(" ")}
            style={activeTab === "branding" ? undefined : { borderColor: "var(--border)" }}
          >
            Branding
          </button>
          <button
            type="button"
            onClick={() => setTab("team")}
            className={[
              "rounded-xl px-4 py-2 text-sm transition",
              activeTab === "team"
                ? "bg-blue-600 text-white"
                : "border text-slate-300 hover:bg-slate-900/50",
            ].join(" ")}
            style={activeTab === "team" ? undefined : { borderColor: "var(--border)" }}
          >
            Team & Users
          </button>
        </div>
      </div>

      {activeTab === "billing" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="text-sm font-semibold text-slate-100">Billing Lifecycle</div>
            <p className="mt-2 text-xs text-slate-400">
              Track plan, renewal date, invoices, and payment status.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">State</div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {billing?.effectiveState || billing?.state || "unknown"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Current Plan</div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {(subscription?.planCode || billing?.planCode || "Not set").toUpperCase()}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Renewal Date</div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {formatDisplayDate(renewalDate)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Payment Method</div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {(latestPayment?.provider || "Not set").toUpperCase()}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Ref: {latestPayment?.providerReference || latestPayment?.providerPaymentId || "--"}
                </div>
              </div>
            </div>

            {billing?.bannerTitle && billing?.bannerMessage ? (
              <div
                className="mt-4 rounded-xl border px-4 py-3 text-sm"
                style={{
                  borderColor:
                    billing.bannerTone === "danger"
                      ? "rgba(244,63,94,0.4)"
                      : billing.bannerTone === "warning"
                        ? "rgba(251,191,36,0.4)"
                        : "rgba(56,189,248,0.4)",
                  backgroundColor:
                    billing.bannerTone === "danger"
                      ? "rgba(190,24,93,0.15)"
                      : billing.bannerTone === "warning"
                        ? "rgba(180,83,9,0.15)"
                        : "rgba(14,116,144,0.15)",
                  color: "var(--text)",
                }}
              >
                <div className="font-semibold">{billing.bannerTitle}</div>
                <div className="mt-1 text-xs text-slate-100/90">{billing.bannerMessage}</div>
              </div>
            ) : null}

            {billingError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {billingError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <label className="block text-sm text-slate-300">
                Plan
                <select
                  value={planCode}
                  onChange={(event) => setPlanCode(event.target.value)}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  disabled={billingLoading || plans.length === 0}
                >
                  {plans.length === 0 ? <option value="">No active plans</option> : null}
                  {plans.map((plan) => (
                    <option key={plan.$id} value={plan.code}>
                      {plan.name} ({Number(plan.priceAmount ?? 0).toLocaleString()} {plan.currency})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Coupon (optional)
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  placeholder="DISCOUNT10"
                  disabled={billingLoading}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => handleStartCheckout()}
                  disabled={checkoutLoading || !planCode || billingLoading}
                  className="btn-primary w-full text-sm disabled:opacity-60"
                >
                  {checkoutLoading
                    ? "Starting checkout..."
                    : planCode && currentPlan && selectedPlan && selectedPlan.code !== currentPlan.code
                      ? selectedPlan.priceAmount >= currentPlan.priceAmount
                        ? "Upgrade Plan"
                        : "Downgrade Plan"
                      : "Pay / Renew Plan"}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleStartCheckout(subscription?.planCode || billing?.planCode || planCode)}
                disabled={checkoutLoading || billingLoading || !(subscription?.planCode || billing?.planCode || planCode)}
                className="btn-secondary text-sm disabled:opacity-60"
              >
                Update Payment Method
              </button>
              <button
                type="button"
                onClick={() => handleBillingAction("cancel")}
                disabled={!canCancelSubscription || billingActionLoading != null}
                className="btn-danger text-sm disabled:opacity-60"
              >
                {billingActionLoading === "cancel"
                  ? "Cancelling..."
                  : "Cancel at Period End"}
              </button>
              <button
                type="button"
                onClick={() => handleBillingAction("reactivate")}
                disabled={!canReactivateSubscription || billingActionLoading != null}
                className="btn-secondary text-sm disabled:opacity-60"
              >
                {billingActionLoading === "reactivate"
                  ? "Reactivating..."
                  : "Reactivate Subscription"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="text-sm font-semibold text-slate-100">Invoice History</div>
            <p className="mt-2 text-xs text-slate-500">
              Latest invoices for this workspace subscription.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[980px] w-full text-left text-sm text-slate-300">
                <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
                  <tr>
                    <th className="px-4 py-3">Invoice No.</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Amount Due</th>
                    <th className="px-4 py-3">Issued</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr
                      key={invoice.$id}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{invoice.invoiceNumber}</td>
                      <td className="px-4 py-3">{invoice.status}</td>
                      <td className="amount px-4 py-3">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </td>
                      <td className="amount px-4 py-3">
                        {formatMoney(invoice.amountDue, invoice.currency)}
                      </td>
                      <td className="px-4 py-3">{formatDisplayDate(invoice.issuedAt)}</td>
                      <td className="px-4 py-3">{formatDisplayDate(invoice.dueDate)}</td>
                      <td className="px-4 py-3">{formatDisplayDate(invoice.paidAt)}</td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={7}>
                        No invoices yet for this workspace.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "branding" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="text-sm font-semibold text-slate-100">Workspace Branding</div>
          <p className="mt-2 text-xs text-slate-500">
            Upload company logo and default watermark settings for report exports.
          </p>

          {brandingLoading ? (
            <div className="mt-4 text-sm text-slate-500">Loading branding settings...</div>
          ) : null}

          <form className="mt-5 space-y-5" onSubmit={handleSaveBranding}>
            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-4">
                <label className="block text-sm text-slate-300">
                  Company Logo (PNG/JPG/WEBP, max 2MB)
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setBrandingFile(file);
                      if (file) {
                        setBrandingPreviewUrl(URL.createObjectURL(file));
                      } else if (branding.logoFileId) {
                        setBrandingPreviewUrl(
                          getFileViewUrl(
                            branding.logoBucketId || rcmsReceiptsBucketId,
                            branding.logoFileId
                          )
                        );
                      } else {
                        setBrandingPreviewUrl(null);
                      }
                    }}
                    disabled={brandingSaving}
                  />
                </label>
                <div className="text-xs text-slate-500">
                  Current file: {branding.logoFileName || "No logo uploaded"}
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={branding.wmEnabled}
                    onChange={(event) =>
                      setBranding((prev) => ({ ...prev, wmEnabled: event.target.checked }))
                    }
                    disabled={brandingSaving || (!branding.logoFileId && !brandingFile)}
                  />
                  Enable watermark by default
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block text-sm text-slate-300">
                    Position
                    <select
                      value={branding.wmPosition}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmPosition: event.target.value as WatermarkPosition,
                        }))
                      }
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      disabled={brandingSaving}
                    >
                      {WATERMARK_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {position.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-slate-300">
                    Opacity ({Math.round(branding.wmOpacity * 100)}%)
                    <input
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={Math.round(branding.wmOpacity * 100)}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmOpacity: clampWatermarkOpacity(Number(event.target.value) / 100),
                        }))
                      }
                      className="mt-2 w-full"
                      disabled={brandingSaving}
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Size ({branding.wmScale}%)
                    <input
                      type="range"
                      min={10}
                      max={80}
                      step={1}
                      value={branding.wmScale}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmScale: clampWatermarkScale(Number(event.target.value)),
                        }))
                      }
                      className="mt-2 w-full"
                      disabled={brandingSaving}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={brandingSaving}
                    className="btn-primary text-sm disabled:opacity-60"
                  >
                    {brandingSaving ? "Saving..." : "Save Branding"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    disabled={brandingSaving || (!branding.logoFileId && !brandingFile)}
                    className="btn-secondary text-sm disabled:opacity-60"
                  >
                    Remove Logo
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Watermark Preview
                </div>
                <div
                  className="relative h-64 overflow-hidden rounded-2xl border"
                  style={{ borderColor: "var(--border)", backgroundColor: "#f8fafc" }}
                >
                  <div className="absolute inset-0 p-5 text-[11px] text-slate-500">
                    <div className="font-semibold text-slate-700">RCMS Sample Report</div>
                    <div className="mt-2 space-y-1">
                      <div>Summary of Tenants&apos; Payment Status</div>
                      <div>Range: 01/03/26 to 31/03/26</div>
                      <div>Total Rent Collected: 4,500,000</div>
                    </div>
                  </div>
                  {brandingPreviewUrl && branding.wmEnabled ? (
                    <img
                      src={brandingPreviewUrl}
                      alt="Watermark preview"
                      className="pointer-events-none absolute select-none object-contain"
                      style={{
                        width: `${branding.wmScale}%`,
                        opacity: branding.wmOpacity,
                        left:
                          branding.wmPosition === "top_left" || branding.wmPosition === "bottom_left"
                            ? "10px"
                            : branding.wmPosition === "top_right" || branding.wmPosition === "bottom_right"
                              ? "auto"
                              : "50%",
                        right:
                          branding.wmPosition === "top_right" || branding.wmPosition === "bottom_right"
                            ? "10px"
                            : "auto",
                        top:
                          branding.wmPosition === "top_left" || branding.wmPosition === "top_right"
                            ? "10px"
                            : branding.wmPosition === "bottom_left" || branding.wmPosition === "bottom_right"
                              ? "auto"
                              : "50%",
                        bottom:
                          branding.wmPosition === "bottom_left" || branding.wmPosition === "bottom_right"
                            ? "10px"
                            : "auto",
                        transform:
                          branding.wmPosition === "center" ? "translate(-50%, -50%)" : undefined,
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                      {brandingPreviewUrl
                        ? "Enable watermark to preview placement."
                        : "Upload a logo to preview watermark."}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  These are default settings. Reports page allows per-export overrides.
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "team" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="text-sm font-semibold text-slate-100">Add Team User</div>
          <p className="mt-2 text-xs text-slate-500">
            For existing users, leave password empty to only update role assignment.
          </p>
          {planLimits.maxTeamMembers != null ? (
            <div className="mt-3 text-xs text-amber-300">
              Team member usage: {teamMemberLimitStatus.used.toLocaleString()} /{" "}
              {formatLimitValue(teamMemberLimitStatus.limit)}
              {teamMemberLimitStatus.reached
                ? " (limit reached - upgrade to add more users)"
                : ""}
              {teamMemberLimitStatus.reached ? (
                <Link to="/app/upgrade" className="ml-2 underline">
                  Upgrade Plan
                </Link>
              ) : null}
            </div>
          ) : null}
          {!manageUsersAccess.allowed ? (
            <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 text-sm text-amber-100">
              {manageUsersAccess.reason ||
                "User management is locked on your current plan. Upgrade to continue."}
              <div className="mt-2">
                <Link to="/app/upgrade" className="underline">
                  View plans and upgrade
                </Link>
              </div>
            </div>
          ) : null}

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Full Name
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jane Doe"
                  disabled={!manageUsersAccess.allowed}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jane@example.com"
                  required
                  disabled={!manageUsersAccess.allowed}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Password (for new users)
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  disabled={!manageUsersAccess.allowed}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as AppRole)}
                  disabled={!manageUsersAccess.allowed}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                >
                  <option value="viewer">Viewer</option>
                  <option value="clerk">Clerk</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={submitting || !manageUsersAccess.allowed}
                className="btn-primary text-sm disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Create / Update User"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={submitting || !manageUsersAccess.allowed}
                className="btn-secondary text-sm disabled:opacity-60"
              >
                Clear
              </button>
            </div>
          </form>

          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

          {result && (
            <div className="mt-5 rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm">
              <div className="font-semibold text-emerald-200">
                {result.created ? "User created successfully." : "User role updated successfully."}
              </div>
              <div className="mt-2 text-emerald-100/90">
                {result.user.name} ({result.user.email}) is now assigned as {result.role}.
              </div>
            </div>
          )}

          <WorkspaceInvitationsPanel />
        </div>
      )}
    </section>
  );
}
