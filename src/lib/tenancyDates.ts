import { isValid, parseISO } from "date-fns";
import { buildMonthSeries } from "../ui/payments/allocation";
import type { Tenant } from "./schema";

function parseDateSafe(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function getTenantUpdatedAt(tenant: Tenant): Date | null {
  const updatedAt = (tenant as Tenant & { $updatedAt?: string }).$updatedAt;
  return parseDateSafe(updatedAt);
}

export function isTenantInactiveAtDate(tenant: Tenant, cutoffDate: Date): boolean {
  const moveOut = parseDateSafe(tenant.moveOutDate);
  if (moveOut && moveOut.getTime() <= cutoffDate.getTime()) {
    return true;
  }

  if (tenant.status !== "inactive") {
    return false;
  }

  if (moveOut) {
    return moveOut.getTime() <= cutoffDate.getTime();
  }

  const updatedAt = getTenantUpdatedAt(tenant);
  if (!updatedAt) {
    return true;
  }
  return updatedAt.getTime() <= cutoffDate.getTime();
}

export function getTenantEffectiveEndDate(tenant: Tenant, referenceDate: Date): Date {
  const moveOut = parseDateSafe(tenant.moveOutDate);
  const deactivatedAt =
    tenant.status === "inactive" && !moveOut ? getTenantUpdatedAt(tenant) : null;
  const candidates = [referenceDate, moveOut, deactivatedAt].filter(
    (value): value is Date => Boolean(value)
  );

  return candidates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest
  );
}

export function buildTenantMonthSeries(
  tenant: Tenant,
  referenceDate: Date,
  extraMonths = 0
): string[] {
  const endDate = getTenantEffectiveEndDate(tenant, referenceDate);
  return buildMonthSeries(tenant.moveInDate, endDate, extraMonths);
}
