import { Query } from "appwrite";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { createBillingCheckoutSession, verifyBillingPayment } from "../../lib/billing";
import { COLLECTIONS, type Plan } from "../../lib/schema";
import { formatLimitValue, parsePlanLimits } from "../../lib/planLimits";

type PlanWithLimits = {
  plan: Plan;
  limits: ReturnType<typeof parsePlanLimits>;
};

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

export default function UpgradePage() {
  const { role, billing, planCode, planLimits, user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [plans, setPlans] = useState<PlanWithLimits[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const billingVerifyHandledRef = useRef<string | null>(null);

  const canCheckout = role === "admin";
  const isLocked = billing?.accessState === "locked";
  const lockTone = billing?.bannerTone ?? "warning";
  const lockMessage =
    (location.state as { message?: string } | null)?.message ??
    billing?.bannerMessage ??
    null;

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
        setSelectedPlanCode((current) => current || planCode || rows[0]?.plan.code || "");
      } catch {
        if (!active) return;
        setPlans([]);
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
  }, [planCode]);

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
          workspaceId: user?.workspaceId,
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
      }
    })();
  }, [searchParams, setSearchParams, toast, user?.workspaceId]);

  const selectedPlan = useMemo(
    () => plans.find((entry) => entry.plan.code === selectedPlanCode)?.plan ?? null,
    [plans, selectedPlanCode]
  );

  const handleCheckout = async () => {
    if (!selectedPlanCode) {
      toast.push("warning", "Select a plan first.");
      return;
    }
    setCheckoutLoading(true);
    try {
      const result = await createBillingCheckoutSession({
        workspaceId: user?.workspaceId || undefined,
        planCode: selectedPlanCode,
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

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Upgrade</div>
        <h3 className="mt-3 text-2xl font-semibold text-white">Plan & Billing Access</h3>
        <p className="mt-2 text-sm text-slate-400">
          Compare plans, review limits, and restore access when features are locked.
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
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Current Plan</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">
              {(planCode || "trial").toUpperCase()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Billing state: {billing?.effectiveState || billing?.state || "unknown"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm">
            <div className="font-semibold text-slate-100">{billing?.bannerTitle || "Billing"}</div>
            <div className="mt-1 text-xs text-slate-400">
              {billing?.bannerMessage || "Your workspace access follows the current billing lifecycle."}
            </div>
            {billing?.daysRemaining != null ? (
              <div className="mt-1 text-xs text-amber-300">
                {billing.daysRemaining} day(s) remaining
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Houses</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatLimitValue(planLimits.maxHouses)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Active Tenants</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatLimitValue(planLimits.maxActiveTenants)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Team Members</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatLimitValue(planLimits.maxTeamMembers)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">Exports / Month</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatLimitValue(planLimits.exportsPerMonth)}
            </div>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-100">Plan Comparison</div>
          {!canCheckout ? (
            <div className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
              Only workspace admins can checkout or upgrade.
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
                    const current = plan.code === planCode;
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
                                name="upgrade-plan"
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
                  onClick={handleCheckout}
                  disabled={!canCheckout || checkoutLoading || !selectedPlan}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {checkoutLoading
                    ? "Starting checkout..."
                    : isLocked
                      ? "Unlock Access"
                      : selectedPlanCode === planCode
                        ? "Pay Current Plan"
                        : "Upgrade Plan"}
                </button>
                <Link to="/app/settings" className="btn-secondary text-sm">
                  Billing Settings
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
