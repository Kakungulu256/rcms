import { decodeJson, type Plan } from "./schema";

export const PLAN_LIMIT_KEYS = [
  "maxProperties",
  "maxLandlords",
  "maxHouses",
  "maxActiveTenants",
  "maxTeamMembers",
  "exportsPerMonth",
] as const;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export type PlanLimits = Record<PlanLimitKey, number | null>;

const DEFAULT_PLAN_LIMITS: PlanLimits = {
  maxProperties: null,
  maxLandlords: null,
  maxHouses: null,
  maxActiveTenants: null,
  maxTeamMembers: null,
  exportsPerMonth: null,
};

const LIMIT_ALIASES: Record<PlanLimitKey, string[]> = {
  maxProperties: ["maxProperties", "properties", "max_properties"],
  maxLandlords: ["maxLandlords", "landlords", "max_landlords"],
  maxHouses: ["maxHouses", "houses", "max_houses"],
  maxActiveTenants: ["maxActiveTenants", "activeTenants", "max_active_tenants"],
  maxTeamMembers: ["maxTeamMembers", "teamMembers", "max_team_members"],
  exportsPerMonth: [
    "exportsPerMonth",
    "reportExportsPerMonth",
    "exports_per_month",
  ],
};

function parseLimitValue(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.floor(value);
}

function pickLimitValue(container: Record<string, unknown>, key: PlanLimitKey) {
  for (const alias of LIMIT_ALIASES[key]) {
    const parsed = parseLimitValue(container[alias]);
    if (parsed != null) return parsed;
  }
  return null;
}

export function parsePlanLimits(plan?: Plan | null): PlanLimits {
  const parsed = decodeJson<Record<string, unknown>>(plan?.limitsJson ?? null);
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_PLAN_LIMITS };
  }

  const container =
    parsed.limits && typeof parsed.limits === "object"
      ? (parsed.limits as Record<string, unknown>)
      : parsed;

  return PLAN_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = pickLimitValue(container, key);
    return acc;
  }, { ...DEFAULT_PLAN_LIMITS });
}

export function getLimitStatus(limit: number | null, used: number) {
  const normalizedUsed = Math.max(0, Math.floor(Number(used) || 0));
  if (limit == null) {
    return {
      used: normalizedUsed,
      limit: null,
      remaining: null,
      reached: false,
      ratio: null,
    };
  }
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const remaining = Math.max(normalizedLimit - normalizedUsed, 0);
  const reached = normalizedUsed >= normalizedLimit;
  const ratio = normalizedLimit > 0 ? Math.min(normalizedUsed / normalizedLimit, 1) : 1;
  return {
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining,
    reached,
    ratio,
  };
}

export function formatLimitValue(limit: number | null) {
  return limit == null ? "Unlimited" : limit.toLocaleString();
}
