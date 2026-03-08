import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { PAYMENT_METHODS } from "../../lib/schema";
import type { Payment, PaymentForm as PaymentFormValues, Tenant } from "../../lib/schema";

type Props = {
  tenants: Tenant[];
  payments: Payment[];
  onSubmit: (values: PaymentFormValues) => void;
  disabled?: boolean;
  loading?: boolean;
};

function getPaymentTenantId(payment: Payment) {
  return typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";
}

function resolveDepositBalance(tenant: Tenant) {
  const amount =
    typeof tenant.securityDepositAmount === "number" &&
    Number.isFinite(tenant.securityDepositAmount)
      ? tenant.securityDepositAmount
      : 0;
  const paid =
    typeof tenant.securityDepositPaid === "number" &&
    Number.isFinite(tenant.securityDepositPaid)
      ? tenant.securityDepositPaid
      : 0;
  const balance =
    typeof tenant.securityDepositBalance === "number" &&
    Number.isFinite(tenant.securityDepositBalance)
      ? tenant.securityDepositBalance
      : amount - paid;
  return Math.max(balance, 0);
}

export default function PaymentForm({
  tenants,
  payments,
  onSubmit,
  disabled,
  loading,
}: Props) {
  const { register, handleSubmit, formState, watch, setValue } = useForm<PaymentFormValues>({
    defaultValues: {
      tenant: "",
      amount: 0,
      method: "cash",
      paymentDate: new Date().toISOString().slice(0, 10),
      applySecurityDeposit: false,
      reference: "",
      notes: "",
    },
  });
  const selectedTenantId = watch("tenant");
  const amount = watch("amount");
  const applySecurityDeposit = watch("applySecurityDeposit");
  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.$id === selectedTenantId) ?? null,
    [selectedTenantId, tenants]
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
  const hasPriorValidPayment = useMemo(() => {
    if (!selectedTenant) return false;
    return payments.some((payment) => {
      if (payment.isReversal) return false;
      if (reversedPaymentIds.has(payment.$id)) return false;
      return getPaymentTenantId(payment) === selectedTenant.$id;
    });
  }, [payments, reversedPaymentIds, selectedTenant]);
  const isNewTenant = (selectedTenant?.tenantType ?? "old") === "new";
  const depositRequired =
    isNewTenant && (selectedTenant?.securityDepositRequired ?? true);
  const depositBalance = selectedTenant ? resolveDepositBalance(selectedTenant) : 0;
  const isFirstPaymentDepositEligible =
    Boolean(selectedTenant) &&
    depositRequired &&
    depositBalance > 0 &&
    !hasPriorValidPayment;
  const suggestedDeposit = Math.min(Math.max(Number(amount) || 0, 0), depositBalance);

  useEffect(() => {
    setValue("applySecurityDeposit", isFirstPaymentDepositEligible, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [isFirstPaymentDepositEligible, setValue]);

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <label className="block text-sm text-slate-300">
        Tenant
        <select
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("tenant", { required: true })}
        >
          <option value="" disabled>
            Select tenant
          </option>
          {tenants.map((tenant) => (
            <option key={tenant.$id} value={tenant.$id}>
              {tenant.fullName}
            </option>
          ))}
        </select>
      </label>
      {selectedTenant && (
        <div
          className="rounded-xl border px-4 py-3 text-xs"
          style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
        >
          <div className="text-slate-300">
            Tenant Type:{" "}
            <span className="font-semibold text-slate-100">
              {isNewTenant ? "New" : "Old"}
            </span>
          </div>
          {isNewTenant && (
            <div className="mt-1 text-slate-400">
              Security Deposit Outstanding:{" "}
              {depositBalance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </div>
          )}
          {isFirstPaymentDepositEligible ? (
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("applySecurityDeposit")}
                  disabled
                />
                Security deposit will be applied automatically on this first payment
              </label>
              {applySecurityDeposit && (
                <div className="text-slate-400">
                  Deposit amount to apply from this payment:{" "}
                  {suggestedDeposit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </div>
              )}
            </div>
          ) : isNewTenant ? (
            <div className="mt-2 text-slate-500">
              Deposit is not available for this payment (already handled, no balance, or not first payment).
            </div>
          ) : null}
        </div>
      )}

      <label className="block text-sm text-slate-300">
        Amount Paid
        <input
          type="number"
          step="0.01"
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("amount", { required: true, valueAsNumber: true })}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Payment Method
        <select
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("method", { required: true })}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {method === "cash" ? "Cash" : "Bank Deposit"}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-300">
        Payment Date
        <input
          type="date"
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("paymentDate", { required: true })}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Reference (Optional)
        <input
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("reference")}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Payment Status Note
        <textarea
          rows={3}
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          placeholder="Example: Paid by bank transfer, receipt pending"
          {...register("notes", {
            validate: (value) =>
              Boolean(value?.trim()) || "Payment status note is required.",
          })}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Receipt Upload (Optional)
        <input
          type="file"
          accept=".pdf,image/*"
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-xs file:text-slate-100"
          {...register("receiptFile")}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Upload bank slip or payment receipt image/PDF.
        </span>
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="btn-primary w-full text-sm disabled:opacity-60"
      >
        {loading ? "Preparing..." : "Preview Allocation"}
      </button>

      {formState.errors.tenant && (
        <p className="text-sm text-rose-300">Tenant is required.</p>
      )}
      {formState.errors.amount && (
        <p className="text-sm text-rose-300">Amount is required.</p>
      )}
      {formState.errors.notes && (
        <p className="text-sm text-rose-300">
          {formState.errors.notes.message || "Payment status note is required."}
        </p>
      )}
    </form>
  );
}
