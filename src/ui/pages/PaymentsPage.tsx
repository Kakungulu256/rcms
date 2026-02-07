import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { format, parseISO } from "date-fns";
import { account, databases, functions, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
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

export default function PaymentsPage() {
  const { user } = useAuth();
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
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.tenants, [
          Query.orderAsc("fullName"),
        ]),
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.houses, [
          Query.orderAsc("code"),
        ]),
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.payments, [
          Query.orderDesc("paymentDate"),
        ]),
      ]);
      setTenants(tenantResult.documents as unknown as Tenant[]);
      setHouses(houseResult.documents as unknown as House[]);
      setPayments(paymentResult.documents as unknown as Payment[]);
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

  const handlePreview = (values: PaymentFormValues) => {
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

  const parseExecution = (response?: string) => {
    try {
      return response ? JSON.parse(response) : null;
    } catch {
      return null;
    }
  };

  const handleConfirm = async () => {
    if (!previewState) return;
    setConfirmLoading(true);
    setLoading(true);
    setError(null);
    try {
      if (!allocateFunctionId) {
        throw new Error("Allocate payment function ID is missing.");
      }
      const jwt = await account.createJWT();
      const execution = await functions.createExecution(
        allocateFunctionId,
        JSON.stringify({
          jwt: jwt.jwt,
          tenantId: previewState.form.tenant,
          amount: previewState.form.amount,
          method: previewState.form.method,
          paymentDate: previewState.form.paymentDate,
          reference: previewState.form.reference,
          notes: previewState.form.notes,
        })
      );
      const result = parseExecution((execution as any).response);
      if (!result || !result.ok || !result.payment) {
        console.error("Allocate function returned error:", result);
        throw new Error("Allocation failed.");
      }
      setPayments((prev) => [result.payment as Payment, ...prev]);
      setConfirmOpen(false);
      setModalOpen(false);
      await loadData();
      toast.push("success", "Payment recorded.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (result.payment as Payment).$id,
          action: "create",
          actorId: user.id,
          details: previewState.form,
        });
      }
    } catch (err) {
      console.error("Payment recording failed:", err);
      setError("Failed to record payment.");
      toast.push("error", "Failed to record payment.");
    } finally {
      setConfirmLoading(false);
      setLoading(false);
    }
  };

  const handleReverse = async () => {
    if (!reverseTarget) return;
    setReverseLoadingId(reverseTarget.$id);
    setLoading(true);
    setError(null);
    try {
      if (!allocateFunctionId) {
        throw new Error("Allocate payment function ID is missing.");
      }
      const jwt = await account.createJWT();
      const execution = await functions.createExecution(
        allocateFunctionId,
        JSON.stringify({
          jwt: jwt.jwt,
          reversePaymentId: reverseTarget.$id,
          paymentDate: new Date().toISOString().slice(0, 10),
          notes: `Reversal of ${reverseTarget.$id}`,
        })
      );
      const result = parseExecution((execution as any).response);
      if (!result || !result.ok || !result.reversal) {
        console.error("Reversal function returned error:", result);
        throw new Error("Reversal failed.");
      }
      setPayments((prev) => [result.reversal as Payment, ...prev]);
      setReverseTarget(null);
      await loadData();
      toast.push("success", "Payment reversed.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (result.reversal as Payment).$id,
          action: "reverse",
          actorId: user.id,
          details: { reversedPaymentId: reverseTarget.$id },
        });
      }
    } catch (err) {
      console.error("Payment reversal failed:", err);
      setError("Failed to reverse payment.");
      toast.push("error", "Failed to reverse payment.");
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
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary text-sm"
        >
          New Payment
        </button>
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
              {payments.slice(0, 6).map((payment) => {
                const tenantLabel =
                  typeof payment.tenant === "string"
                    ? tenantLookup.get(payment.tenant)?.fullName ?? payment.tenant
                    : payment.tenant?.fullName ?? "Tenant";
                const allocation = payment.allocationJson
                  ? JSON.parse(payment.allocationJson)
                  : {};
                const isExpanded = expandedPaymentId === payment.$id;
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
                    {!payment.isReversal && (
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
              {payments.length === 0 && (
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
        open={modalOpen}
        title="New Payment"
        description="Preview allocation before confirming."
        onClose={() => setModalOpen(false)}
      >
          <PaymentForm tenants={tenants} onSubmit={handlePreview} disabled={loading} loading={loading} />
        </Modal>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Payment"
        description="This payment will be saved and applied to arrears first. Continue?"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        confirmLoading={confirmLoading}
      />
      <ConfirmModal
        open={!!reverseTarget}
        title="Reverse Payment"
        description="This will create a reversal entry. Continue?"
        onCancel={() => setReverseTarget(null)}
        onConfirm={handleReverse}
        confirmLoading={reverseLoadingId === reverseTarget?.$id}
      />
    </section>
  );
}
