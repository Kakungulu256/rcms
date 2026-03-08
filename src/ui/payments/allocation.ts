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

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function monthKey(date: Date) {
  return format(date, "yyyy-MM");
}

export function getPaymentMonthAmounts(
  payment: Payment
): Array<{ month: string; amount: number }> {
  const multiplier = payment.isReversal ? -1 : 1;
  const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
  if (allocation) {
    return Object.entries(allocation)
      .map(([month, amount]) => ({
        month,
        amount: Number(amount) * multiplier,
      }))
      .filter(
        (entry) =>
          Boolean(entry.month) &&
          Number.isFinite(entry.amount) &&
          entry.amount !== 0
      );
  }

  const month = payment.paymentDate?.slice(0, 7) ?? "";
  const amount = Math.abs(Number(payment.amount) || 0) * multiplier;
  if (!month || !Number.isFinite(amount) || amount === 0) {
    return [];
  }
  return [{ month, amount }];
}

export function buildPaidByMonth(payments: Payment[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const seenReversalTargets = new Set<string>();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      if (seenReversalTargets.has(payment.reversedPaymentId)) return;
      seenReversalTargets.add(payment.reversedPaymentId);
    }
    getPaymentMonthAmounts(payment).forEach(({ month, amount }) => {
      totals[month] = (totals[month] ?? 0) + amount;
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
    const paymentDate = payment.paymentDate?.slice(0, 10) ?? "";
    getPaymentMonthAmounts(payment).forEach(({ month, amount }) => {
      if (!summary[month]) summary[month] = [];
      summary[month].push({
        month,
        paymentDate,
        amount,
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
  let remainingPayment = roundMoney(amount);
  const lines: AllocationLine[] = months.map((month) => {
    const paid = paidByMonth[month] ?? 0;
    const rent = rentByMonth[month] ?? 0;
    const remaining = roundMoney(Math.max(rent - paid, 0));
    const applied = roundMoney(Math.min(remaining, remainingPayment));
    remainingPayment = roundMoney(remainingPayment - applied);
    return {
      month,
      expected: rent,
      paid,
      remaining,
      applied,
    };
  });

  return {
    totalApplied: roundMoney(amount - remainingPayment),
    lines,
  };
}
