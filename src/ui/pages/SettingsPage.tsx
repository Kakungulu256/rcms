import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Query } from "appwrite";
import { Link, useSearchParams } from "react-router-dom";
import {
  account,
  createWorkspaceDocument,
  databases,
  functions,
  listAllDocuments,
  rcmsDatabaseId,
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
  type WorkspaceMembership,
} from "../../lib/schema";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";

type AppRole = "admin" | "clerk" | "viewer";
type SettingsTab = "billing" | "team";
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

  const activeWorkspaceId = getActiveWorkspaceId();
  const manageUsersFunctionId = import.meta.env.VITE_MANAGE_USERS_FUNCTION_ID as
    | string
    | undefined;
  const manageUsersAccess = canAccessFeature("settings.manage_users");
  const teamMemberLimitStatus = getLimitStatus(planLimits.maxTeamMembers, teamMemberCount);

  const currentTab = (searchParams.get("tab") || "billing").toLowerCase();
  const activeTab: SettingsTab = currentTab === "team" ? "team" : "billing";

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
    try {
      const [subscriptionRows, invoiceRows, paymentRows] = await Promise.all([
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
      ]);
      const latestSubscription = subscriptionRows[0] ?? null;
      setSubscription(latestSubscription);
      setInvoices(invoiceRows.slice(0, 25));
      setBillingPayments(paymentRows.slice(0, 25));
      setPlanCode((current) => current || latestSubscription?.planCode || "");
    } catch (loadError) {
      setBillingError("Failed to load billing settings.");
      setSubscription(null);
      setInvoices([]);
      setBillingPayments([]);
    } finally {
      setBillingLoading(false);
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
        </div>
      )}
    </section>
  );
}