import { decodeJson } from "./schema";
import type { Payment, PaymentAllocation } from "./schema";

export function normalizePaymentNote(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getReversedOriginalIds(payments: Payment[]) {
  const reversed = new Set<string>();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      reversed.add(payment.reversedPaymentId);
    }
  });
  return reversed;
}

function paymentTouchesMonth(payment: Payment, monthKey: string) {
  const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
  if (!allocation) {
    return payment.paymentDate?.slice(0, 7) === monthKey;
  }
  return Number(allocation[monthKey] ?? 0) > 0;
}

function paymentTouchesRange(
  payment: Payment,
  startMonthKey: string,
  endMonthKey: string
) {
  const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
  if (!allocation) {
    const month = payment.paymentDate?.slice(0, 7) ?? "";
    return month >= startMonthKey && month <= endMonthKey;
  }
  return Object.entries(allocation).some(
    ([month, amount]) =>
      month >= startMonthKey &&
      month <= endMonthKey &&
      Number(amount ?? 0) > 0
  );
}

export function getLatestPaymentNoteForMonth(
  payments: Payment[],
  monthKey: string
): string | null {
  const reversedOriginalIds = getReversedOriginalIds(payments);
  const sorted = payments
    .filter((payment) => !payment.isReversal && !reversedOriginalIds.has(payment.$id))
    .filter((payment) => paymentTouchesMonth(payment, monthKey))
    .slice()
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

  for (const payment of sorted) {
    const note = normalizePaymentNote(payment.notes);
    if (note) return note;
  }
  return null;
}

export function getLatestPaymentNoteForRange(
  payments: Payment[],
  startMonthKey: string,
  endMonthKey: string
): string | null {
  const reversedOriginalIds = getReversedOriginalIds(payments);
  const sorted = payments
    .filter((payment) => !payment.isReversal && !reversedOriginalIds.has(payment.$id))
    .filter((payment) => paymentTouchesRange(payment, startMonthKey, endMonthKey))
    .slice()
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

  for (const payment of sorted) {
    const note = normalizePaymentNote(payment.notes);
    if (note) return note;
  }
  return null;
}
