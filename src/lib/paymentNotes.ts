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
