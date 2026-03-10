import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Query } from "appwrite";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import {
  createWorkspaceDocument,
  databases,
  listAllDocuments,
  rcmsDatabaseId,
  updateScopedDocument,
} from "../../lib/appwrite";
import { logAudit } from "../../lib/audit";
import { createBillingCheckoutSession, verifyBillingPayment } from "../../lib/billing";
import { formatDisplayDate } from "../../lib/dateDisplay";
import {
  COLLECTIONS,
  type BillingPayment,
  type Invoice,
  type Plan,
  type Subscription,
} from "../../lib/schema";
import { formatLimitValue, parsePlanLimits } from "../../lib/planLimits";

type BillingAction = "cancel" | "reactivate";

type PlanWithLimits = {
  plan: Plan;
  limits: ReturnType<typeof parsePlanLimits>;
};

function formatMoney(amount: number | undefined, currency = "UGX") {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `0 ${currency}`;
  return `${value.toLocaleString()} ${currency}`;
}

function formatPlanPrice(amount: number | undefined, currency: string | undefined) {
  if (!Number.isFinite(amount as number)) {
    return "Configured by platform owner";
  }

  const isoCurrency = String(currency ?? "UGX").trim().toUpperCase() || "UGX";
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: isoCurrency,
      maximumFractionDigits: 0,
    }).format(Number(amount));
    return `${formatted} / month`;
  } catch {
    return `${Number(amount).toLocaleString()} ${isoCurrency} / month`;
  }
}

export default function BillingDashboardPage() {
  const { user, billing, planCode, role, refresh } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [plans, setPlans] = useState<PlanWithLimits[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billingPayments, setBillingPayments] = useState<BillingPayment[]>([]);
  const [billingActionLoading, setBillingActionLoading] =
    useState<BillingAction | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const billingVerifyHandledRef = useRef<string | null>(null);

  const activeWorkspaceId = user?.hasWorkspace ? user.workspaceId : "";
  const canCheckout = role === "admin";
  const isLocked = billing?.accessState === "locked";
  const lockTone = billing?.bannerTone ?? "warning";
  const lockMessage =
    (location.state as { message?: string } | null)?.message ??
    billing?.bannerMessage ??
    null;

  const latestPayment = useMemo(() => {
    const preferred =
      billingPayments.find((entry) => entry.status === "succeeded") ?? null;
    return preferred ?? billingPayments[0] ?? null;
  }, [billingPayments]);

  const currentPlanCode =
    subscription?.planCode || billing?.planCode || planCode || "trial";

  const currentPlan = useMemo(
    () => plans.find((entry) => entry.plan.code === currentPlanCode)?.plan ?? null,
    [plans, currentPlanCode]
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

  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      setLoading(true);
      try {
        const response = await databases.listDocuments(rcmsDatabaseId, COLLECTIONS.plans, [
          Query.equal("isActive", [true]),
          Query.orderAsc("sortOrder"),
          Query.limit(50),
        ]);
        const rows = (response.documents as unknown as Plan[]).map((plan) => ({
          plan,
          limits: parsePlanLimits(plan),
        }));
        if (!active) return;
        setPlans(rows);
        setSelectedPlanCode((current) => current || currentPlanCode || rows[0]?.plan.code || "");
      } catch {
        if (active) {
          setPlans([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void loadPlans();
    return () => {
      active = false;
    };
  }, [currentPlanCode]);

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
      setInvoices(invoiceRows.slice(0, 20));
      setBillingPayments(paymentRows.slice(0, 20));
    } catch {
      setBillingError("Failed to load billing settings.");
      setSubscription(null);
      setInvoices([]);
      setBillingPayments([]);
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    void loadBillingData();
  }, []);

  useEffect(() => {
    const transactionId =
      searchParams.get("transaction_id") || searchParams.get("transactionId");
    if (!transactionId || billingVerifyHandledRef.current === transactionId) return;

    billingVerifyHandledRef.current = transactionId;
    const txRef = searchParams.get("tx_ref") || searchParams.get("txRef") || "";
    const status = (searchParams.get("status") || "").toLowerCase();

    const cleanupParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("transaction_id");
      next.delete("transactionId");
      next.delete("tx_ref");
      next.delete("txRef");
      next.delete("status");
      setSearchParams(next, { replace: true });
    };

    if (status && ["cancelled", "canceled", "failed"].includes(status)) {
      toast.push("warning", "Payment was not completed. Please retry if needed.");
      cleanupParams();
      return;
    }

    void (async () => {
      try {
        const result = await verifyBillingPayment({
          workspaceId: activeWorkspaceId,
          transactionId,
          txRef: txRef || undefined,
        });
        if (result.ok && result.status === "succeeded") {
          toast.push("success", "Payment verified and subscription updated.");
        } else if (result.ok) {
          toast.push("warning", `Payment status: ${result.status}.`);
        } else {
          toast.push("error", result.error || "Failed to verify payment.");
        }
      } catch (verifyError) {
        toast.push(
          "error",
          verifyError instanceof Error ? verifyError.message : "Failed to verify payment."
        );
      } finally {
        cleanupParams();
        await loadBillingData();
        await refresh();
      }
    })();
  }, [searchParams, activeWorkspaceId, refresh, setSearchParams, toast]);

  const handleStartCheckout = async (planToUse: string) => {
    if (!planToUse.trim()) {
      toast.push("warning", "Select a plan first.");
      return;
    }
    setCheckoutLoading(true);
    try {
      const result = await createBillingCheckoutSession({
        workspaceId: activeWorkspaceId,
        planCode: planToUse,
        couponCode: couponCode.trim() || undefined,
      });
      if (!result.ok) {
        throw new Error(result.error || "Failed to start checkout.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      toast.push(
        "error",
        error instanceof Error ? error.message : "Failed to start checkout."
      );
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
              notes: "Cancellation requested by workspace admin from billing dashboard.",
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
              notes: "Reactivated by workspace admin from billing dashboard.",
            };

      const updated = await updateScopedDocument<typeof patch, Subscription>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.subscriptions,
        documentId: subscription.$id,
        data: patch,
      });

      await updateScopedDocument(
        {
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.workspaces,
          documentId: activeWorkspaceId,
          data: {
            subscriptionState: updated.state,
          },
        }
      ).catch(() => null);

      await createWorkspaceDocument({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.subscriptionEvents,
        data: {
          subscriptionId: updated.$id,
          eventType:
            action === "cancel"
              ? "subscription_cancel_requested"
              : "subscription_reactivated",
          eventSource: "billing_dashboard",
          eventTime: nowIso,
          stateFrom: previousState,
          stateTo: updated.state,
          idempotencyKey: `billing_dashboard_${action}_${updated.$id}_${Date.now()}`,
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

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">
          Billing
        </div>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Billing Dashboard
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Review your subscription, manage plan changes, and control billing actions
          in one place.
        </p>
      </header>

      {lockMessage ? (
        <div
          className={`billing-banner rounded-2xl border px-4 py-3 text-sm billing-banner-${lockTone}`}
          style={{
            borderColor:
              lockTone === "danger"
                ? "rgba(244, 63, 94, 0.45)"
                : lockTone === "warning"
                  ? "rgba(251, 191, 36, 0.45)"
                  : "rgba(56, 189, 248, 0.45)",
            backgroundColor:
              lockTone === "danger"
                ? "rgba(190, 24, 93, 0.12)"
                : lockTone === "warning"
                  ? "rgba(180, 83, 9, 0.12)"
                  : "rgba(14, 116, 144, 0.12)",
          }}
        >
          {lockMessage}
        </div>
      ) : null}

      <div
        className="rounded-2xl border p-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Current Subscription
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-100">
              {(currentPlan?.name || currentPlanCode).toUpperCase()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Billing state: {billing?.effectiveState || billing?.state || "unknown"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm">
            <div className="font-semibold text-slate-100">
              {billing?.bannerTitle || "Billing status"}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {billing?.bannerMessage ||
                "Your workspace access follows the current billing lifecycle."}
            </div>
            {billing?.daysRemaining != null ? (
              <div className="mt-1 text-xs text-amber-300">
                {billing.daysRemaining} day(s) remaining
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">State</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {billing?.effectiveState || billing?.state || "unknown"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Plan</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {(currentPlan?.name || currentPlanCode).toUpperCase()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Renewal Date</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatDisplayDate(renewalDate)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Payment Method</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {(latestPayment?.provider || "Not set").toUpperCase()}
            </div>
          </div>
        </div>

        {billingError ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {billingError}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleStartCheckout(currentPlanCode)}
            disabled={!canCheckout || checkoutLoading || billingLoading || !currentPlanCode}
            className="btn-secondary text-sm disabled:opacity-60"
          >
            {checkoutLoading ? "Starting checkout..." : "Update Payment Method"}
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

      <div
        className="rounded-2xl border p-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Plan Comparison</div>
            <p className="mt-1 text-xs text-slate-400">
              Upgrade or downgrade based on your current workspace needs.
            </p>
          </div>
          {!canCheckout ? (
            <div className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
              Only workspace admins can manage billing.
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-slate-500">Loading active plans...</div>
        ) : plans.length === 0 ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            No active plans found. Configure plans in the catalog first.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[980px] w-full text-left text-sm text-slate-300">
                <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
                  <tr>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Houses</th>
                    <th className="px-4 py-3">Active Tenants</th>
                    <th className="px-4 py-3">Team Members</th>
                    <th className="px-4 py-3">Exports / Month</th>
                    <th className="px-4 py-3">Trial Days</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map(({ plan, limits }) => {
                    const current = plan.code === currentPlanCode;
                    return (
                      <tr
                        key={plan.$id}
                        className="border-t odd:bg-slate-950/30"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="radio"
                                name="billing-plan"
                                value={plan.code}
                                checked={selectedPlanCode === plan.code}
                                onChange={(event) => setSelectedPlanCode(event.target.value)}
                                disabled={!canCheckout}
                              />
                              <span className="font-semibold text-slate-100">{plan.name}</span>
                            </label>
                            {current ? (
                              <span className="rounded-full border border-slate-500 bg-white px-2 py-0.5 text-[11px] font-bold text-black">
                                Current
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{plan.code}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {formatPlanPrice(plan.priceAmount, plan.currency)}
                        </td>
                        <td className="px-4 py-3">{formatLimitValue(limits.maxHouses)}</td>
                        <td className="px-4 py-3">{formatLimitValue(limits.maxActiveTenants)}</td>
                        <td className="px-4 py-3">{formatLimitValue(limits.maxTeamMembers)}</td>
                        <td className="px-4 py-3">{formatLimitValue(limits.exportsPerMonth)}</td>
                        <td className="px-4 py-3">{Number(plan.trialDays ?? 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
              <label className="block text-sm text-slate-300">
                Coupon (optional)
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  placeholder="DISCOUNT10"
                  disabled={!canCheckout}
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => handleStartCheckout(selectedPlanCode)}
                  disabled={!canCheckout || checkoutLoading || !selectedPlanCode}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {checkoutLoading
                    ? "Starting checkout..."
                    : isLocked
                      ? "Restore Access"
                      : selectedPlanCode === currentPlanCode
                        ? "Pay Current Plan"
                        : "Change Plan"}
                </button>
                <Link to="/app/settings" className="btn-secondary text-sm">
                  Workspace Settings
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {invoices.length > 0 ? (
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
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
