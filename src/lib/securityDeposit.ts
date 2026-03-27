import { isValid, parseISO } from "date-fns";
import type { House, Payment, SecurityDepositDeduction, Tenant } from "./schema";
import { buildMonthSeries, buildPaidByMonth } from "../ui/payments/allocation";
import { buildRentByMonth } from "./rentHistory";
import { getTenantEffectiveEndDate } from "./tenancyDates";

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export type SecurityDepositRefundAssessment = {
  depositPaid: number;
  depositRequired: number;
  deductionsTotal: number;
  arrearsTotal: number;
  availableDeposit: number;
  refundableAmount: number;
  canRefund: boolean;
};

export function calculateTenantArrears(params: {
  tenant: Tenant;
  house?: House | null;
  payments: Payment[];
  asOfDate?: string | Date | null;
}): number {
  const { tenant, house, payments, asOfDate } = params;
  const endDate =
    resolveDate(asOfDate) ?? getTenantEffectiveEndDate(tenant, new Date());
  if (!endDate) return 0;

  const months = buildMonthSeries(tenant.moveInDate, endDate);
  if (months.length === 0) return 0;

  const paidByMonth = buildPaidByMonth(payments);
  const rentByMonth = buildRentByMonth({
    months,
    tenantHistoryJson: null,
    houseHistoryJson: house?.rentHistoryJson ?? null,
    fallbackRent: house?.monthlyRent ?? 0,
    occupancyStartDate: tenant.moveInDate,
    occupancyEndDate: tenant.moveOutDate ?? endDate.toISOString().slice(0, 10),
  });
  const expected = months.reduce(
    (sum, month) => sum + (rentByMonth[month] ?? 0),
    0
  );
  const paid = months.reduce((sum, month) => sum + (paidByMonth[month] ?? 0), 0);
  return roundMoney(Math.max(expected - paid, 0));
}

export function assessSecurityDepositRefund(params: {
  tenant: Tenant;
  house?: House | null;
  payments: Payment[];
  deductions: SecurityDepositDeduction[];
  asOfDate?: string | Date | null;
}): SecurityDepositRefundAssessment {
  const { tenant, house, payments, deductions, asOfDate } = params;
  const depositPaid = roundMoney(
    Math.max(Number(tenant.securityDepositPaid) || 0, 0)
  );
  const depositRequired = roundMoney(
    Math.max(Number(tenant.securityDepositAmount) || 0, 0)
  );
  const deductionsTotal = roundMoney(
    deductions.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
  );
  const arrearsTotal = calculateTenantArrears({
    tenant,
    house,
    payments,
    asOfDate,
  });
  const availableDeposit = roundMoney(depositPaid - deductionsTotal);
  const refundableAmount = roundMoney(Math.max(availableDeposit - arrearsTotal, 0));

  return {
    depositPaid,
    depositRequired,
    deductionsTotal,
    arrearsTotal,
    availableDeposit,
    refundableAmount,
    canRefund: refundableAmount > 0,
  };
}
