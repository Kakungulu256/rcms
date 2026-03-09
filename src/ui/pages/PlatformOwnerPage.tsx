import { ID } from "appwrite";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { startOfMonth } from "date-fns";
import { databases, listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { logAudit } from "../../lib/audit";
import { formatDisplayDate } from "../../lib/dateDisplay";
import { getPlatformOwnerConfigSummary } from "../../lib/platformOwner";
import {
  COLLECTIONS,
  decodeJson,
  encodeJson,
  type BillingPayment,
  type Coupon,
  type Plan,
  type Subscription,
  type SubscriptionEvent,
  type SubscriptionState,
  type Workspace,
} from "../../lib/schema";

type StateCount = Record<SubscriptionState, number>;

type PlanDraft = {
  priceAmount: string;
  trialDays: string;
  isActive: boolean;
  saving: boolean;
};

type CouponFormState = {
  code: string;
  name: string;
  description: string;
  discountPercent: string;
  appliesToPlanCodesCsv: string;
  validFrom: string;
  validUntil: string;
  maxRedemptions: string;
  maxRedemptionsPerWorkspace: string;
  minPlanAmount: string;
  isActive: boolean;
};

const EMPTY_COUPON_FORM: CouponFormState = {
  code: "",
  name: "",
  description: "",
  discountPercent: "",
  appliesToPlanCodesCsv: "",
  validFrom: "",
  validUntil: "",
  maxRedemptions: "",
  maxRedemptionsPerWorkspace: "",
  minPlanAmount: "",
  isActive: true,
};

const INITIAL_STATE_COUNTS: StateCount = {
  trialing: 0,
  active: 0,
  past_due: 0,
  canceled: 0,
  expired: 0,
};

function getTimestamp(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function docTimestamp(document: { $updatedAt?: string; $createdAt?: string }) {
  return Math.max(getTimestamp(document.$updatedAt), getTimestamp(document.$createdAt));
}

function parseNumberInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toDateOnlyInput(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatMoney(value: number, currency = "UGX") {
  if (!Number.isFinite(value)) return `0 ${currency}`;
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

function parsePlanCodesCsv(value: string) {
  const unique = new Set<string>();
  value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => unique.add(entry));
  return Array.from(unique);
}

function mapCouponToForm(coupon: Coupon): CouponFormState {
  const appliedPlanCodes =
    decodeJson<string[]>(coupon.appliesToPlanCodesJson ?? null)
      ?.filter((value) => String(value ?? "").trim().length > 0)
      .join(", ") ?? "";

  return {
    code: coupon.code ?? "",
    name: coupon.name ?? "",
    description: coupon.description ?? "",
    discountPercent: String(Number(coupon.discountPercent ?? 0)),
    appliesToPlanCodesCsv: appliedPlanCodes,
    validFrom: toDateOnlyInput(coupon.validFrom),
    validUntil: toDateOnlyInput(coupon.validUntil),
    maxRedemptions: coupon.maxRedemptions != null ? String(Number(coupon.maxRedemptions)) : "",
    maxRedemptionsPerWorkspace:
      coupon.maxRedemptionsPerWorkspace != null
        ? String(Number(coupon.maxRedemptionsPerWorkspace))
        : "",
    minPlanAmount: coupon.minPlanAmount != null ? String(Number(coupon.minPlanAmount)) : "",
    isActive: Boolean(coupon.isActive),
  };
}

function normalizeState(
  value?: string | null,
  fallback: SubscriptionState = "trialing"
): SubscriptionState {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "trialing" ||
    normalized === "active" ||
    normalized === "past_due" ||
    normalized === "canceled" ||
    normalized === "expired"
  ) {
    return normalized;
  }
  return fallback;
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

export default function PlatformOwnerPage() {
  const { user } = useAuth();
  const toast = useToast();
  const ownerConfig = getPlatformOwnerConfigSummary();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [togglingCouponId, setTogglingCouponId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [billingPayments, setBillingPayments] = useState<BillingPayment[]>([]);
  const [subscriptionEvents, setSubscriptionEvents] = useState<SubscriptionEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({});
  const [couponForm, setCouponForm] = useState<CouponFormState>({ ...EMPTY_COUPON_FORM });
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        workspaceRows,
        subscriptionRows,
        billingPaymentRows,
        subscriptionEventRows,
        planRows,
        couponRows,
      ] = await Promise.all([
        listAllDocuments<Workspace>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.workspaces,
          skipWorkspaceScope: true,
        }),
        listAllDocuments<Subscription>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.subscriptions,
          skipWorkspaceScope: true,
        }),
        listAllDocuments<BillingPayment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.paymentsBilling,
          skipWorkspaceScope: true,
        }),
        listAllDocuments<SubscriptionEvent>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.subscriptionEvents,
          skipWorkspaceScope: true,
        }),
        listAllDocuments<Plan>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.plans,
          skipWorkspaceScope: true,
        }),
        listAllDocuments<Coupon>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.coupons,
          skipWorkspaceScope: true,
        }),
      ]);

      setWorkspaces(workspaceRows);
      setSubscriptions(subscriptionRows);
      setBillingPayments(billingPaymentRows);
      setSubscriptionEvents(subscriptionEventRows);
      setPlans(
        [...planRows].sort((left, right) => {
          const leftOrder = Number(left.sortOrder ?? 0);
          const rightOrder = Number(right.sortOrder ?? 0);
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return left.name.localeCompare(right.name);
        })
      );
      setCoupons(
        [...couponRows].sort(
          (left, right) => docTimestamp(right as unknown as any) - docTimestamp(left as unknown as any)
        )
      );
    } catch {
      setError("Failed to load platform owner data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setPlanDrafts((current) => {
      const next: Record<string, PlanDraft> = {};
      plans.forEach((plan) => {
        const existing = current[plan.$id];
        next[plan.$id] = {
          priceAmount: existing?.priceAmount ?? String(Number(plan.priceAmount ?? 0)),
          trialDays: existing?.trialDays ?? String(Math.max(0, Number(plan.trialDays ?? 0))),
          isActive: existing?.isActive ?? Boolean(plan.isActive),
          saving: false,
        };
      });
      return next;
    });
  }, [plans]);

  const workspaceMap = useMemo(() => {
    const next = new Map<string, Workspace>();
    workspaces.forEach((workspace) => {
      next.set(workspace.$id, workspace);
    });
    return next;
  }, [workspaces]);

  const planByCode = useMemo(() => {
    const next = new Map<string, Plan>();
    plans.forEach((plan) => {
      next.set(plan.code, plan);
    });
    return next;
  }, [plans]);

  const latestSubscriptionsByWorkspace = useMemo(() => {
    const next = new Map<string, Subscription>();
    const sorted = [...subscriptions].sort(
      (left, right) =>
        docTimestamp(right as unknown as any) - docTimestamp(left as unknown as any)
    );
    sorted.forEach((subscription) => {
      const workspaceId = String(subscription.workspaceId ?? "").trim();
      if (!workspaceId || next.has(workspaceId)) return;
      next.set(workspaceId, subscription);
    });
    return next;
  }, [subscriptions]);

  const stateMetrics = useMemo(() => {
    const counts: StateCount = { ...INITIAL_STATE_COUNTS };
    const planDistribution = new Map<string, number>();
    let estimatedMrr = 0;
    let estimatedMrrCurrency = "UGX";

    workspaces.forEach((workspace) => {
      const latest = latestSubscriptionsByWorkspace.get(workspace.$id);
      const state = normalizeState(latest?.state ?? workspace.subscriptionState, "trialing");
      counts[state] += 1;

      const code = String(latest?.planCode ?? "trial").trim().toLowerCase() || "trial";
      planDistribution.set(code, (planDistribution.get(code) ?? 0) + 1);

      if (state === "active") {
        const plan = latest?.planCode ? planByCode.get(latest.planCode) : null;
        estimatedMrr += Number(plan?.priceAmount ?? 0);
        estimatedMrrCurrency = String(plan?.currency ?? estimatedMrrCurrency);
      }
    });

    const monthStart = startOfMonth(new Date()).getTime();
    const succeededPayments = billingPayments.filter((payment) => payment.status === "succeeded");
    const lifetimeCollections = succeededPayments.reduce(
      (sum, payment) => sum + Number(payment.amount ?? 0),
      0
    );
    const monthlyCollections = succeededPayments
      .filter((payment) => getTimestamp(payment.paidAt) >= monthStart)
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    const collectionCurrency = String(
      succeededPayments[0]?.currency ?? plans[0]?.currency ?? estimatedMrrCurrency ?? "UGX"
    ).toUpperCase();

    return {
      counts,
      totalSignups: workspaces.length,
      estimatedMrr,
      estimatedMrrCurrency: estimatedMrrCurrency.toUpperCase(),
      monthlyCollections,
      lifetimeCollections,
      collectionCurrency,
      planDistribution: Array.from(planDistribution.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [billingPayments, latestSubscriptionsByWorkspace, planByCode, plans, workspaces]);

  const recentActivity = useMemo(() => {
    const sorted = [...subscriptionEvents].sort((left, right) => {
      const leftTime = getTimestamp(left.eventTime) || docTimestamp(left as unknown as any);
      const rightTime = getTimestamp(right.eventTime) || docTimestamp(right as unknown as any);
      return rightTime - leftTime;
    });
    return sorted.slice(0, 20).map((event) => {
      const workspace = workspaceMap.get(String(event.workspaceId ?? "").trim());
      return {
        event,
        workspaceName: workspace?.name || event.workspaceId || "--",
      };
    });
  }, [subscriptionEvents, workspaceMap]);

  const handlePlanDraftChange = (
    planId: string,
    field: keyof Omit<PlanDraft, "saving">,
    value: string | boolean
  ) => {
    setPlanDrafts((current) => ({
      ...current,
      [planId]: {
        ...current[planId],
        [field]: value,
      },
    }));
  };

  const handleSavePlan = async (plan: Plan) => {
    const draft = planDrafts[plan.$id];
    if (!draft || !user) return;

    const priceAmount = parseNumberInput(draft.priceAmount);
    if (priceAmount == null || priceAmount < 0) {
      toast.push("warning", "Plan price must be a number greater than or equal to 0.");
      return;
    }

    const trialDaysInput = parseNumberInput(draft.trialDays);
    if (trialDaysInput == null || trialDaysInput < 0) {
      toast.push("warning", "Trial days must be a number greater than or equal to 0.");
      return;
    }

    setPlanDrafts((current) => ({
      ...current,
      [plan.$id]: {
        ...current[plan.$id],
        saving: true,
      },
    }));

    try {
      await databases.updateDocument(rcmsDatabaseId, COLLECTIONS.plans, plan.$id, {
        priceAmount,
        trialDays: Math.floor(trialDaysInput),
        isActive: draft.isActive,
      });

      await logAudit({
        workspaceId: user.workspaceId,
        entityType: "platform_plan",
        entityId: plan.$id,
        action: "update",
        actorId: user.id,
        details: {
          code: plan.code,
          next: {
            priceAmount,
            trialDays: Math.floor(trialDaysInput),
            isActive: draft.isActive,
          },
        },
      });

      toast.push("success", `Plan ${plan.code.toUpperCase()} updated.`);
      await loadData();
    } catch (error) {
      toast.push(
        "error",
        error instanceof Error ? error.message : "Failed to update plan."
      );
      setPlanDrafts((current) => ({
        ...current,
        [plan.$id]: {
          ...current[plan.$id],
          saving: false,
        },
      }));
    }
  };

  const handleStartCouponCreate = () => {
    setEditingCouponId(null);
    setCouponForm({ ...EMPTY_COUPON_FORM });
  };

  const handleEditCoupon = (coupon: Coupon) => {
    setEditingCouponId(coupon.$id);
    setCouponForm(mapCouponToForm(coupon));
  };

  const handleSaveCoupon = async () => {
    if (!user) return;
    const normalizedCode = couponForm.code.trim().toUpperCase();
    if (!normalizedCode) {
      toast.push("warning", "Coupon code is required.");
      return;
    }

    const discountPercent = parseNumberInput(couponForm.discountPercent);
    if (discountPercent == null || discountPercent <= 0 || discountPercent > 100) {
      toast.push("warning", "Discount percent must be between 0.01 and 100.");
      return;
    }

    if (couponForm.validFrom && couponForm.validUntil) {
      const from = getTimestamp(`${couponForm.validFrom}T00:00:00.000Z`);
      const until = getTimestamp(`${couponForm.validUntil}T23:59:59.000Z`);
      if (from > until) {
        toast.push("warning", "Coupon valid-until date cannot be earlier than valid-from date.");
        return;
      }
    }

    const targetPlanCodes = parsePlanCodesCsv(couponForm.appliesToPlanCodesCsv);
    const maxRedemptions = parseNumberInput(couponForm.maxRedemptions);
    const maxPerWorkspace = parseNumberInput(couponForm.maxRedemptionsPerWorkspace);
    const minPlanAmount = parseNumberInput(couponForm.minPlanAmount);

    setSavingCoupon(true);
    try {
      const payload = stripUndefined({
        code: normalizedCode,
        name: couponForm.name.trim() || null,
        description: couponForm.description.trim() || null,
        discountPercent: Number(discountPercent.toFixed(2)),
        appliesToPlanCodesJson:
          targetPlanCodes.length > 0 ? encodeJson(targetPlanCodes) : null,
        validFrom: couponForm.validFrom ? `${couponForm.validFrom}T00:00:00.000Z` : null,
        validUntil: couponForm.validUntil ? `${couponForm.validUntil}T23:59:59.000Z` : null,
        maxRedemptions: maxRedemptions != null ? Math.floor(maxRedemptions) : null,
        maxRedemptionsPerWorkspace:
          maxPerWorkspace != null ? Math.floor(maxPerWorkspace) : null,
        minPlanAmount: minPlanAmount != null ? Math.round(minPlanAmount) : null,
        isActive: couponForm.isActive,
      });

      if (editingCouponId) {
        await databases.updateDocument(
          rcmsDatabaseId,
          COLLECTIONS.coupons,
          editingCouponId,
          payload
        );
      } else {
        await databases.createDocument(rcmsDatabaseId, COLLECTIONS.coupons, ID.unique(), {
          ...payload,
          redemptionCount: 0,
          metadataJson: null,
        });
      }

      await logAudit({
        workspaceId: user.workspaceId,
        entityType: "platform_coupon",
        entityId: editingCouponId ?? normalizedCode,
        action: editingCouponId ? "update" : "create",
        actorId: user.id,
        details: {
          code: normalizedCode,
          discountPercent: Number(discountPercent.toFixed(2)),
          targetPlanCodes,
          isActive: couponForm.isActive,
        },
      });

      toast.push(
        "success",
        editingCouponId
          ? `Coupon ${normalizedCode} updated.`
          : `Coupon ${normalizedCode} created.`
      );
      setEditingCouponId(null);
      setCouponForm({ ...EMPTY_COUPON_FORM });
      await loadData();
    } catch (error) {
      toast.push(
        "error",
        error instanceof Error ? error.message : "Failed to save coupon."
      );
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleToggleCoupon = async (coupon: Coupon) => {
    if (!user) return;
    setTogglingCouponId(coupon.$id);
    try {
      await databases.updateDocument(rcmsDatabaseId, COLLECTIONS.coupons, coupon.$id, {
        isActive: !coupon.isActive,
      });

      await logAudit({
        workspaceId: user.workspaceId,
        entityType: "platform_coupon",
        entityId: coupon.$id,
        action: "update",
        actorId: user.id,
        details: {
          code: coupon.code,
          previousActive: Boolean(coupon.isActive),
          nextActive: !coupon.isActive,
        },
      });

      toast.push(
        "success",
        `Coupon ${coupon.code.toUpperCase()} ${coupon.isActive ? "deactivated" : "activated"}.`
      );
      await loadData();
    } catch (error) {
      toast.push(
        "error",
        error instanceof Error ? error.message : "Failed to update coupon status."
      );
    } finally {
      setTogglingCouponId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Platform</div>
        <h3 className="mt-3 text-2xl font-semibold text-white">Owner Dashboard</h3>
        <p className="mt-2 text-sm text-slate-400">
          Monitor all subscriber workspaces and manage plans/coupons globally.
        </p>
      </header>

      {ownerConfig.ownerEmailsConfigured === 0 && ownerConfig.ownerUserIdsConfigured === 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Platform owner env is not configured. Set{" "}
          <code className="font-mono text-xs">VITE_PLATFORM_OWNER_EMAILS</code> or{" "}
          <code className="font-mono text-xs">VITE_PLATFORM_OWNER_USER_IDS</code>.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Total Signups</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {stateMetrics.totalSignups.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Trialing</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {stateMetrics.counts.trialing.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Active Paid</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {stateMetrics.counts.active.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Past Due</div>
          <div className="mt-2 text-2xl font-semibold text-amber-200">
            {stateMetrics.counts.past_due.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Churned</div>
          <div className="mt-2 text-2xl font-semibold text-rose-200">
            {(stateMetrics.counts.canceled + stateMetrics.counts.expired).toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Est. MRR</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {formatMoney(stateMetrics.estimatedMrr, stateMetrics.estimatedMrrCurrency)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Collections (This Month)
          </div>
          <div className="mt-2 text-2xl font-semibold text-emerald-200">
            {formatMoney(stateMetrics.monthlyCollections, stateMetrics.collectionCurrency)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Collections (Lifetime)
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {formatMoney(stateMetrics.lifetimeCollections, stateMetrics.collectionCurrency)}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="text-sm font-semibold text-slate-100">Plan Distribution</div>
          <div className="mt-4 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
                <tr>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Workspaces</th>
                </tr>
              </thead>
              <tbody>
                {stateMetrics.planDistribution.map(([planCode, count]) => (
                  <tr key={planCode} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3">
                      {(planByCode.get(planCode)?.name || planCode || "trial").toUpperCase()}
                    </td>
                    <td className="px-4 py-3">{count.toLocaleString()}</td>
                  </tr>
                ))}
                {stateMetrics.planDistribution.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-slate-500" colSpan={2}>
                      No subscription plan distribution data yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-100">Recent Workspace Activity</div>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="btn-secondary text-xs disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="mt-4 overflow-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="min-w-[760px] w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
                <tr>
                  <th className="px-4 py-3">Event Time</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map(({ event, workspaceName }) => (
                  <tr key={event.$id} className="border-t odd:bg-slate-950/30" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3">{formatDisplayDate(event.eventTime)}</td>
                    <td className="px-4 py-3">{workspaceName}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{event.eventType}</div>
                      <div className="text-xs text-slate-500">{event.eventSource || "--"}</div>
                    </td>
                    <td className="px-4 py-3">{event.stateFrom || "--"}</td>
                    <td className="px-4 py-3">{event.stateTo || "--"}</td>
                  </tr>
                ))}
                {recentActivity.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-slate-500" colSpan={5}>
                      No recent workspace activity yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="text-sm font-semibold text-slate-100">Global Plan Controls</div>
        <p className="mt-1 text-xs text-slate-500">
          Update plan pricing, trial days, and active status globally.
        </p>
        <div className="mt-4 overflow-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          <table className="min-w-[900px] w-full text-left text-sm text-slate-300">
            <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Trial Days</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const draft = planDrafts[plan.$id];
                return (
                  <tr key={plan.$id} className="border-t odd:bg-slate-950/30" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 font-semibold text-slate-100">{plan.name}</td>
                    <td className="px-4 py-3">{plan.code}</td>
                    <td className="px-4 py-3">{plan.currency}</td>
                    <td className="px-4 py-3">
                      <input
                        value={draft?.priceAmount ?? ""}
                        onChange={(event) =>
                          handlePlanDraftChange(plan.$id, "priceAmount", event.target.value)
                        }
                        className="input-base w-full rounded-md px-3 py-2 text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={draft?.trialDays ?? ""}
                        onChange={(event) =>
                          handlePlanDraftChange(plan.$id, "trialDays", event.target.value)
                        }
                        className="input-base w-full rounded-md px-3 py-2 text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(draft?.isActive)}
                          onChange={(event) =>
                            handlePlanDraftChange(plan.$id, "isActive", event.target.checked)
                          }
                        />
                        <span>{draft?.isActive ? "Active" : "Inactive"}</span>
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void handleSavePlan(plan)}
                        disabled={Boolean(draft?.saving)}
                        className="btn-secondary text-xs disabled:opacity-60"
                      >
                        {draft?.saving ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-100">Coupon Management</div>
          <button type="button" onClick={handleStartCouponCreate} className="btn-secondary text-xs">
            New Coupon
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Create and manage percentage coupons with plan targeting and expiry windows.
        </p>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {editingCouponId ? "Edit Coupon" : "Create Coupon"}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Code
                <input
                  value={couponForm.code}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                  }
                  placeholder="DISCOUNT15"
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Discount %
                <input
                  value={couponForm.discountPercent}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, discountPercent: event.target.value }))
                  }
                  placeholder="15"
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Name (optional)
                <input
                  value={couponForm.name}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, name: event.target.value }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Plan Targeting
                <input
                  value={couponForm.appliesToPlanCodesCsv}
                  onChange={(event) =>
                    setCouponForm((current) => ({
                      ...current,
                      appliesToPlanCodesCsv: event.target.value,
                    }))
                  }
                  placeholder="starter, growth"
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block text-sm text-slate-300">
              Description
              <textarea
                value={couponForm.description}
                onChange={(event) =>
                  setCouponForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={3}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Valid From
                <input
                  type="date"
                  value={couponForm.validFrom}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, validFrom: event.target.value }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Valid Until
                <input
                  type="date"
                  value={couponForm.validUntil}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, validUntil: event.target.value }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm text-slate-300">
                Max Redemptions
                <input
                  value={couponForm.maxRedemptions}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, maxRedemptions: event.target.value }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Max / Workspace
                <input
                  value={couponForm.maxRedemptionsPerWorkspace}
                  onChange={(event) =>
                    setCouponForm((current) => ({
                      ...current,
                      maxRedemptionsPerWorkspace: event.target.value,
                    }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Min Plan Amount
                <input
                  value={couponForm.minPlanAmount}
                  onChange={(event) =>
                    setCouponForm((current) => ({ ...current, minPlanAmount: event.target.value }))
                  }
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={couponForm.isActive}
                onChange={(event) =>
                  setCouponForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              Active
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveCoupon()}
                disabled={savingCoupon}
                className="btn-primary text-sm disabled:opacity-60"
              >
                {savingCoupon ? "Saving..." : editingCouponId ? "Update Coupon" : "Create Coupon"}
              </button>
              {editingCouponId ? (
                <button type="button" onClick={handleStartCouponCreate} className="btn-secondary text-sm">
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </div>

          <div className="overflow-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="min-w-[640px] w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
                <tr>
                  <th className="px-4 py-3">Coupon</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const targetPlanCodes = decodeJson<string[]>(coupon.appliesToPlanCodesJson ?? null) ?? [];
                  return (
                    <tr key={coupon.$id} className="border-t odd:bg-slate-950/30" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{coupon.code}</div>
                        <div className="text-xs text-slate-500">{coupon.name || "--"}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {targetPlanCodes.length > 0 ? `Plans: ${targetPlanCodes.join(", ")}` : "All plans"}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {coupon.isActive ? "Active" : "Inactive"}
                        </div>
                      </td>
                      <td className="px-4 py-3">{Number(coupon.discountPercent ?? 0)}%</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        <div>From: {formatDisplayDate(coupon.validFrom)}</div>
                        <div>Until: {formatDisplayDate(coupon.validUntil)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        <div>Count: {Number(coupon.redemptionCount ?? 0).toLocaleString()}</div>
                        <div>
                          Max: {coupon.maxRedemptions != null ? Number(coupon.maxRedemptions).toLocaleString() : "Unlimited"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => handleEditCoupon(coupon)} className="btn-secondary text-xs">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleCoupon(coupon)}
                            disabled={togglingCouponId === coupon.$id}
                            className="btn-secondary text-xs disabled:opacity-60"
                          >
                            {togglingCouponId === coupon.$id ? "Saving..." : coupon.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {coupons.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-slate-500" colSpan={5}>
                      No coupons configured.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-500">
          Need workspace-level operations?{" "}
          <Link to="/app/settings?tab=billing" className="underline">
            Open workspace settings
          </Link>
          .
        </div>
      </div>
    </section>
  );
}
