import { decodeJson, type FeatureEntitlement, type Plan } from "./schema";
import type { BillingSnapshot } from "./subscriptionLifecycle";

export const FEATURE_KEYS = [
  "houses.manage",
  "tenants.view",
  "tenants.manage",
  "payments.view",
  "payments.record",
  "payments.reverse",
  "expenses.manage",
  "migration.use",
  "reports.view",
  "security_deposits.view",
  "settings.manage_users",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureEntitlementRule = {
  enabled: boolean;
  limitValue?: number | null;
  limitUnit?: string | null;
  source?: "default" | "plan_json" | "feature_entitlements";
};

export type FeatureEntitlementMap = Record<string, FeatureEntitlementRule>;

export type FeatureAccessDecision = {
  allowed: boolean;
  reason?: string;
  source?: string;
  limitValue?: number | null;
  limitUnit?: string | null;
};

const DEFAULT_ENTITLEMENTS: FeatureEntitlementMap = FEATURE_KEYS.reduce(
  (acc, featureKey) => {
    acc[featureKey] = { enabled: true, source: "default" };
    return acc;
  },
  {} as FeatureEntitlementMap
);

function parseEntitlementsFromPlanJson(plan?: Plan | null): FeatureEntitlementMap {
  const output: FeatureEntitlementMap = {};
  const parsed = decodeJson<Record<string, unknown>>(plan?.entitlementsJson ?? null);
  if (!parsed || typeof parsed !== "object") {
    return output;
  }
  const container =
    parsed.features && typeof parsed.features === "object"
      ? (parsed.features as Record<string, unknown>)
      : parsed;
  for (const [featureKey, raw] of Object.entries(container)) {
    if (typeof raw === "boolean") {
      output[featureKey] = { enabled: raw, source: "plan_json" };
      continue;
    }
    if (raw && typeof raw === "object") {
      const rawObject = raw as Record<string, unknown>;
      const enabled =
        typeof rawObject.enabled === "boolean" ? rawObject.enabled : true;
      const limitValue =
        typeof rawObject.limitValue === "number"
          ? rawObject.limitValue
          : null;
      const limitUnit =
        typeof rawObject.limitUnit === "string" ? rawObject.limitUnit : null;
      output[featureKey] = {
        enabled,
        limitValue,
        limitUnit,
        source: "plan_json",
      };
    }
  }
  return output;
}

function parseRows(rows: FeatureEntitlement[] = []): FeatureEntitlementMap {
  const output: FeatureEntitlementMap = {};
  for (const row of rows) {
    if (!row?.featureKey) continue;
    output[row.featureKey] = {
      enabled: Boolean(row.enabled),
      limitValue:
        typeof row.limitValue === "number" && Number.isFinite(row.limitValue)
          ? row.limitValue
          : null,
      limitUnit: row.limitUnit ?? null,
      source: "feature_entitlements",
    };
  }
  return output;
}

export function buildFeatureEntitlements(params: {
  plan?: Plan | null;
  featureRows?: FeatureEntitlement[];
}) {
  const { plan, featureRows = [] } = params;
  return {
    ...DEFAULT_ENTITLEMENTS,
    ...parseEntitlementsFromPlanJson(plan),
    ...parseRows(featureRows),
  };
}

export function evaluateFeatureAccess(params: {
  featureKey: string;
  billing: BillingSnapshot | null;
  entitlements: FeatureEntitlementMap;
}) {
  const { featureKey, billing, entitlements } = params;
  if (billing?.accessState === "locked") {
    return {
      allowed: false,
      reason:
        billing.bannerMessage ||
        "Feature is locked because billing is inactive.",
      source: "billing",
    } satisfies FeatureAccessDecision;
  }

  const rule = entitlements[featureKey];
  if (!rule) {
    return { allowed: true, source: "default" } satisfies FeatureAccessDecision;
  }
  if (!rule.enabled) {
    return {
      allowed: false,
      reason:
        "Feature is locked on your current plan. Upgrade your subscription to continue.",
      source: rule.source,
      limitValue: rule.limitValue ?? null,
      limitUnit: rule.limitUnit ?? null,
    } satisfies FeatureAccessDecision;
  }
  return {
    allowed: true,
    source: rule.source,
    limitValue: rule.limitValue ?? null,
    limitUnit: rule.limitUnit ?? null,
  } satisfies FeatureAccessDecision;
}
