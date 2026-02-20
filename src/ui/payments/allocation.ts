import { addMonths, format, parseISO, startOfMonth } from "date-fns";
import { decodeJson } from "../../lib/schema";
import type { Payment, PaymentAllocation } from "../../lib/schema";

export type AllocationLine = {
  month: string;
  expected: number;
  paid: number;
  remaining: number;
  applied: number;
};

export type MonthPaymentSummary = {
  month: string;
  paymentDate: string;
  amount: number;
};

export type AllocationPreview = {
  totalApplied: number;
  lines: AllocationLine[];
};

function monthKey(date: Date) {
  return format(date, "yyyy-MM");
}

export function buildPaidByMonth(payments: Payment[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const seenReversalTargets = new Set<string>();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      if (seenReversalTargets.has(payment.reversedPaymentId)) return;
      seenReversalTargets.add(payment.reversedPaymentId);
    }
    const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
    if (!allocation) return;
    const multiplier = payment.isReversal ? -1 : 1;
    Object.entries(allocation).forEach(([month, amount]) => {
      const value = Number(amount) * multiplier;
      if (!Number.isFinite(value) || value === 0) return;
      totals[month] = (totals[month] ?? 0) + value;
    });
  });
  return totals;
}

export function buildPaymentSummaryByMonth(
  payments: Payment[]
): Record<string, MonthPaymentSummary[]> {
  const summary: Record<string, MonthPaymentSummary[]> = {};
  const seenReversalTargets = new Set<string>();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      if (seenReversalTargets.has(payment.reversedPaymentId)) return;
      seenReversalTargets.add(payment.reversedPaymentId);
    }
    const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
    if (!allocation) return;
    const paymentDate = payment.paymentDate?.slice(0, 10) ?? "";
    const multiplier = payment.isReversal ? -1 : 1;
    Object.entries(allocation).forEach(([month, amount]) => {
      const value = Number(amount) * multiplier;
      if (!Number.isFinite(value) || value === 0) return;
      if (!summary[month]) summary[month] = [];
      summary[month].push({
        month,
        paymentDate,
        amount: value,
      });
    });
  });
  Object.values(summary).forEach((entries) => {
    entries.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  });
  return summary;
}

export function buildMonthSeries(
  moveInDate: string,
  endDate: Date | string,
  extraMonths = 0
): string[] {
  const start = startOfMonth(parseISO(moveInDate));
  const endDateValue = typeof endDate === "string" ? parseISO(endDate) : endDate;
  const end = startOfMonth(endDateValue);
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  for (let i = 0; i < extraMonths; i += 1) {
    months.push(monthKey(addMonths(end, i + 1)));
  }
  return months;
}

export function previewAllocation(params: {
  amount: number;
  months: string[];
  paidByMonth: Record<string, number>;
  rentByMonth: Record<string, number>;
}): AllocationPreview {
  const { amount, months, paidByMonth, rentByMonth } = params;
  let remainingPayment = amount;
  const lines: AllocationLine[] = months.map((month) => {
    const paid = paidByMonth[month] ?? 0;
    const rent = rentByMonth[month] ?? 0;
    const remaining = Math.max(rent - paid, 0);
    const applied = Math.min(remaining, remainingPayment);
    remainingPayment -= applied;
    return {
      month,
      expected: rent,
      paid,
      remaining,
      applied,
    };
  });

  return {
    totalApplied: amount - remainingPayment,
    lines,
  };
}
