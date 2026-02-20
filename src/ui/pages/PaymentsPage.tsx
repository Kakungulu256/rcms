import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { format, parseISO } from "date-fns";
import {
  account,
  functions,
  listAllDocuments,
  rcmsDatabaseId,
} from "../../lib/appwrite";
import { COLLECTIONS, decodeJson } from "../../lib/schema";
import type {
  House,
  Payment,
  PaymentForm as PaymentFormValues,
  Tenant,
} from "../../lib/schema";
import AllocationPreviewPanel from "../payments/AllocationPreview";
import ConfirmModal from "../payments/ConfirmModal";
import PaymentForm from "../payments/PaymentForm";
import Modal from "../Modal";
import {
  buildMonthSeries,
  buildPaidByMonth,
  previewAllocation,
} from "../payments/allocation";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { buildRentByMonth } from "../../lib/rentHistory";

type PreviewState = {
  form: PaymentFormValues;
  allocationJson: string;
};

type FunctionResult =
  | { ok: true; payment?: Payment; reversal?: Payment }
  | { ok: false; error?: string };

export default function PaymentsPage() {
  const { user, permissions } = useAuth();
  const canRecordPayments = permissions.canRecordPayments;
  const canReversePayments = permissions.canReversePayments;
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewAllocation> | null>(
    null
  );
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [reverseLoadingId, setReverseLoadingId] = useState<string | null>(null);
  const allocateFunctionId = import.meta.env.VITE_ALLOCATE_RENT_PAYMENT_FUNCTION_ID as
    | string
    | undefined;

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantResult, houseResult, paymentResult] = await Promise.all([
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [Query.orderAsc("fullName")],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [Query.orderAsc("code")],
        }),
        listAllDocuments<Payment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.payments,
          queries: [Query.orderDesc("paymentDate")],
        }),
      ]);
      setTenants(tenantResult);
      setHouses(houseResult);
      setPayments(paymentResult);
    } catch (err) {
      setError("Failed to load payments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const tenantLookup = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.$id, tenant])),
    [tenants]
  );
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const reversedPaymentIds = useMemo(() => {
    const ids = new Set<string>();
    payments.forEach((payment) => {
      if (payment.isReversal && payment.reversedPaymentId) {
        ids.add(payment.reversedPaymentId);
      }
    });
    return ids;
  }, [payments]);
  const reversalByOriginalId = useMemo(() => {
    const map = new Map<string, Payment>();
    payments.forEach((payment) => {
      if (!payment.isReversal || !payment.reversedPaymentId) return;
      const existing = map.get(payment.reversedPaymentId);
      if (!existing || payment.paymentDate > existing.paymentDate) {
        map.set(payment.reversedPaymentId, payment);
      }
    });
    return map;
  }, [payments]);
  const visiblePayments = useMemo(() => {
    return payments.filter((payment) => !payment.isReversal);
  }, [payments]);

  const handlePreview = (values: PaymentFormValues) => {
    if (!canRecordPayments) {
      toast.push("warning", "You do not have permission to record payments.");
      return;
    }
    const tenant = tenantLookup.get(values.tenant);
    if (!tenant) {
      setError("Select a tenant to preview allocation.");
      return;
    }
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
    const house = houseLookup.get(houseId);
    const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;
    const tenantPayments = payments.filter((payment) => {
      const paymentTenantId =
        typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
      return paymentTenantId === tenant.$id;
    });
    const paidByMonth = buildPaidByMonth(tenantPayments);
    const months = buildMonthSeries(tenant.moveInDate, new Date());
    const rentByMonth = buildRentByMonth({
      months,
      tenantHistoryJson: tenant.rentHistoryJson ?? null,
      houseHistoryJson: house?.rentHistoryJson ?? null,
      fallbackRent: rent,
    });
    const allocation = previewAllocation({
      amount: values.amount,
      months,
      paidByMonth,
      rentByMonth,
    });
    const allocationJson = JSON.stringify(
      Object.fromEntries(
        allocation.lines
          .filter((line) => line.applied > 0)
          .map((line) => [line.month, line.applied])
      )
    );
    setPreview(allocation);
    setPreviewState({ form: values, allocationJson });
    setConfirmOpen(true);
  };

  const parseExecutionBody = (response?: string) => {
    try {
      return response ? JSON.parse(response) : null;
    } catch {
      return null;
    }
  };

  const executeAllocationFunction = async (payload: Record<string, unknown>) => {
    if (!allocateFunctionId) {
      throw new Error("Allocate payment function ID is missing.");
    }

    const execution = await functions.createExecution({
      functionId: allocateFunctionId,
      body: JSON.stringify(payload),
      async: false,
    });

    const readBody = (value: any) =>
      (value?.responseBody as string | undefined) ??
      (value?.response as string | undefined) ??
      "";

    let latest: any = execution;
    let body = readBody(latest);
    let attempts = 0;

    while (
      attempts < 8 &&
      (!body || latest?.status === "waiting" || latest?.status === "processing")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      latest = await functions.getExecution({
        functionId: allocateFunctionId,
        executionId: latest.$id,
      });
      body = readBody(latest);
      attempts += 1;
    }

    const parsed = parseExecutionBody(body) as FunctionResult | null;
    return { parsed, latest, body };
  };

  const handleConfirm = async () => {
    if (!previewState) return;
    if (!canRecordPayments) {
      toast.push("warning", "You do not have permission to record payments.");
      return;
    }
    setConfirmLoading(true);
    setLoading(true);
    setError(null);
    try {
      const jwt = await account.createJWT();
      const { parsed, latest, body } = await executeAllocationFunction({
        jwt: jwt.jwt,
        tenantId: previewState.form.tenant,
        amount: previewState.form.amount,
        method: previewState.form.method,
        paymentDate: previewState.form.paymentDate,
        reference: previewState.form.reference,
        notes: previewState.form.notes,
      });
      if (!parsed || !parsed.ok || !parsed.payment) {
        console.error("Allocate function returned error:", {
          parsed,
          status: latest?.status,
          responseStatusCode: latest?.responseStatusCode,
          errors: latest?.errors,
          body,
        });
        throw new Error(
          (parsed && !parsed.ok && parsed.error) ||
            latest?.errors ||
            "Allocation failed."
        );
      }
      setConfirmOpen(false);
      setModalOpen(false);
      await loadData();
      toast.push("success", "Payment recorded.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (parsed.payment as Payment).$id,
          action: "create",
          actorId: user.id,
          details: previewState.form,
        });
      }
    } catch (err) {
      console.error("Payment recording failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Failed to record payment.";
      setError(message);
      toast.push("error", message);
    } finally {
      setConfirmLoading(false);
      setLoading(false);
    }
  };

  const handleReverse = async () => {
    if (!reverseTarget) return;
    if (!canReversePayments) {
      toast.push("warning", "You do not have permission to reverse payments.");
      return;
    }
    if (reversedPaymentIds.has(reverseTarget.$id)) {
      toast.push("warning", "This payment has already been reversed.");
      setReverseTarget(null);
      return;
    }
    const targetId = reverseTarget.$id;
    setReverseLoadingId(reverseTarget.$id);
    setLoading(true);
    setError(null);
    try {
      const jwt = await account.createJWT();
      const { parsed, latest, body } = await executeAllocationFunction({
        jwt: jwt.jwt,
        reversePaymentId: reverseTarget.$id,
        paymentDate: new Date().toISOString().slice(0, 10),
        notes: `Reversal of ${reverseTarget.$id}`,
      });
      if (!parsed || !parsed.ok || !parsed.reversal) {
        console.error("Reversal function returned error:", {
          parsed,
          status: latest?.status,
          responseStatusCode: latest?.responseStatusCode,
          errors: latest?.errors,
          body,
        });
        throw new Error(
          (parsed && !parsed.ok && parsed.error) ||
            latest?.errors ||
            "Reversal failed."
        );
      }
      setReverseTarget(null);
      await loadData();
      toast.push("success", "Payment reversed.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (parsed.reversal as Payment).$id,
          action: "reverse",
          actorId: user.id,
          details: { reversedPaymentId: targetId },
        });
      }
    } catch (err) {
      console.error("Payment reversal failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Failed to reverse payment.";
      setError(message);
      toast.push("error", message);
    } finally {
      setReverseLoadingId(null);
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
        <div className="text-sm text-slate-500">Payments</div>
        <h3 className="mt-2 text-xl font-semibold text-white">Rent Collection</h3>
        <p className="mt-1 text-sm text-slate-500">
          Record rent payments with allocation preview.
        </p>
        </div>
        {canRecordPayments && (
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary text-sm"
          >
            New Payment
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-sm font-semibold text-slate-100">
              Payment History
            </div>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              {visiblePayments.slice(0, 6).map((payment) => {
                const tenantLabel =
                  typeof payment.tenant === "string"
                    ? tenantLookup.get(payment.tenant)?.fullName ?? payment.tenant
                    : payment.tenant?.fullName ?? "Tenant";
                const allocation =
                  decodeJson<Record<string, number>>(payment.allocationJson) ?? {};
                const isExpanded = expandedPaymentId === payment.$id;
                const isAlreadyReversed = reversedPaymentIds.has(payment.$id);
                const reversal = reversalByOriginalId.get(payment.$id);
                return (
                <div
                  key={payment.$id}
                  className="rounded-xl border px-4 py-3"
                  style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {tenantLabel}
                    </span>
                    <span>
                      <span className="amount">
                        {payment.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {format(parseISO(payment.paymentDate), "yyyy-MM-dd")} - {payment.method}
                  </div>
                  <button
                    onClick={() =>
                      setExpandedPaymentId(isExpanded ? null : payment.$id)
                    }
                    className="mt-3 text-xs text-slate-300 underline"
                  >
                    {isExpanded ? "Hide details" : "View details"}
                  </button>
                  {isExpanded && (
                    <div className="mt-3 space-y-2 text-xs text-slate-400">
                      {isAlreadyReversed && reversal && (
                        <div className="text-amber-300">
                          Reversed on {reversal.paymentDate?.slice(0, 10)} (
                          {Math.abs(Number(reversal.amount)).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
                          )
                        </div>
                      )}
                      {Object.entries(allocation).map(([month, amount]) => (
                        <div key={`${payment.$id}-${month}`}>
                          {month}:{" "}
                          {Number(amount).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}{" "}
                          ({payment.paymentDate?.slice(0, 10)})
                        </div>
                      ))}
                      {Object.keys(allocation).length === 0 && (
                        <div>No allocation details.</div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    {isAlreadyReversed && !payment.isReversal && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-300">
                        Reversed
                      </span>
                    )}
                    {canReversePayments && !payment.isReversal && !isAlreadyReversed && (
                      <button
                        onClick={() => setReverseTarget(payment)}
                        className="btn-danger text-xs"
                        disabled={reverseLoadingId === payment.$id}
                      >
                        {reverseLoadingId === payment.$id ? "Reversing..." : "Reverse"}
                      </button>
                    )}
                  </div>
                </div>
              )})}
              {visiblePayments.length === 0 && (
                <div className="text-sm text-slate-500">
                  No payments recorded yet.
                </div>
              )}
            </div>
          </div>

          <AllocationPreviewPanel preview={preview} />
        </div>
      </div>

      <Modal
        open={canRecordPayments && modalOpen}
        title="New Payment"
        description="Preview allocation before confirming."
        onClose={() => setModalOpen(false)}
      >
          <PaymentForm tenants={tenants} onSubmit={handlePreview} disabled={loading} loading={loading} />
        </Modal>

      <ConfirmModal
        open={canRecordPayments && confirmOpen}
        title="Confirm Payment"
        description="This payment will be saved and applied to arrears first. Continue?"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        confirmLoading={confirmLoading}
      />
      <ConfirmModal
        open={canReversePayments && !!reverseTarget}
        title="Reverse Payment"
        description="This will create a reversal entry. Continue?"
        onCancel={() => setReverseTarget(null)}
        onConfirm={handleReverse}
        confirmLoading={reverseLoadingId === reverseTarget?.$id}
      />
    </section>
  );
}
