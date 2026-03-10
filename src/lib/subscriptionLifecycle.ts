import type { Subscription, SubscriptionState, Workspace } from "./schema";

export type BillingAccessState = "full" | "grace" | "locked";

export type BillingBannerTone = "info" | "warning" | "danger";

export type BillingSnapshot = {
  state: SubscriptionState;
  effectiveState: SubscriptionState;
  planCode: string | null;
  trialEndDate: string | null;
  graceEndsAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
  dunningStage: string | null;
  accessState: BillingAccessState;
  lockReason: "trial_expired" | "past_due_expired" | "canceled" | "expired" | null;
  bannerTone: BillingBannerTone | null;
  bannerTitle: string | null;
  bannerMessage: string | null;
  daysRemaining: number | null;
};

function parseDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysRemaining(target: Date, now: Date) {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function evaluateBillingSnapshot(params: {
  workspace?: Workspace | null;
  subscription?: Subscription | null;
  now?: Date;
}): BillingSnapshot | null {
  const { workspace = null, subscription = null } = params;
  const now = params.now ?? new Date();
  if (!workspace && !subscription) {
    return null;
  }

  const rawState = (subscription?.state || workspace?.subscriptionState || "trialing") as SubscriptionState;
  const planCode = subscription?.planCode ?? null;
  const trialEndDate = subscription?.trialEndDate ?? workspace?.trialEndDate ?? null;
  const graceEndsAt = subscription?.graceEndsAt ?? null;
  const nextRetryAt = subscription?.nextRetryAt ?? null;
  const retryCount = Number(subscription?.retryCount ?? 0);
  const dunningStage = subscription?.dunningStage ?? null;

  const trialEnd = parseDate(trialEndDate);
  const graceEnd = parseDate(graceEndsAt);
  const periodEnd = parseDate(subscription?.currentPeriodEnd ?? null);
  const retryAt = parseDate(nextRetryAt);

  const base: BillingSnapshot = {
    state: rawState,
    effectiveState: rawState,
    planCode,
    trialEndDate,
    graceEndsAt,
    nextRetryAt,
    retryCount: Number.isFinite(retryCount) ? retryCount : 0,
    dunningStage,
    accessState: "full",
    lockReason: null,
    bannerTone: null,
    bannerTitle: null,
    bannerMessage: null,
    daysRemaining: null,
  };

  if (rawState === "active") {
    return base;
  }

  if (rawState === "trialing") {
    if (!trialEnd) {
      return {
        ...base,
        bannerTone: "info",
        bannerTitle: "Trial active",
        bannerMessage: "Trial is active. Add a plan to avoid service interruption.",
      };
    }
    const remaining = daysRemaining(trialEnd, now);
    if (remaining <= 0) {
      return {
        ...base,
        effectiveState: "expired",
        accessState: "locked",
        lockReason: "trial_expired",
        bannerTone: "danger",
        bannerTitle: "Trial expired",
        bannerMessage: "Your trial has ended. Upgrade to continue using premium features.",
        daysRemaining: 0,
      };
    }

    return {
      ...base,
      bannerTone: remaining <= 2 ? "warning" : "info",
      bannerTitle: remaining <= 2 ? "Trial ending soon" : "Trial active",
      bannerMessage: `${remaining} day(s) left in trial. Choose a plan before expiry.`,
      daysRemaining: remaining,
    };
  }

  if (rawState === "past_due") {
    if (!graceEnd) {
      return {
        ...base,
        effectiveState: "expired",
        accessState: "locked",
        lockReason: "past_due_expired",
        bannerTone: "danger",
        bannerTitle: "Payment overdue",
        bannerMessage: "Billing is past due and access is locked until payment succeeds.",
        daysRemaining: 0,
      };
    }

    const remaining = daysRemaining(graceEnd, now);
    if (remaining <= 0) {
      return {
        ...base,
        effectiveState: "expired",
        accessState: "locked",
        lockReason: "past_due_expired",
        bannerTone: "danger",
        bannerTitle: "Grace period ended",
        bannerMessage: "Billing grace period has ended. Upgrade or retry payment to unlock access.",
        daysRemaining: 0,
      };
    }

    const retryHint = retryAt ? ` Next retry: ${retryAt.toLocaleString()}.` : "";
    return {
      ...base,
      accessState: "grace",
      bannerTone: "warning",
      bannerTitle: "Payment overdue",
      bannerMessage: `${remaining} day(s) left in grace period.${retryHint}`,
      daysRemaining: remaining,
    };
  }

  if (rawState === "canceled") {
    if (periodEnd && periodEnd.getTime() > now.getTime()) {
      const remaining = daysRemaining(periodEnd, now);
      return {
        ...base,
        accessState: "grace",
        bannerTone: "warning",
        bannerTitle: "Subscription canceled",
        bannerMessage: `Access remains until current period ends in ${remaining} day(s).`,
        daysRemaining: remaining,
      };
    }
    return {
      ...base,
      effectiveState: "expired",
      accessState: "locked",
      lockReason: "canceled",
      bannerTone: "danger",
      bannerTitle: "Subscription canceled",
      bannerMessage: "Subscription has ended. Upgrade to restore full access.",
      daysRemaining: 0,
    };
  }

  return {
    ...base,
    effectiveState: "expired",
    accessState: "locked",
    lockReason: "expired",
    bannerTone: "danger",
    bannerTitle: "Subscription expired",
    bannerMessage: "Subscription has expired. Upgrade to restore full access.",
    daysRemaining: 0,
  };
}
