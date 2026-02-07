import { useForm } from "react-hook-form";
import { PAYMENT_METHODS } from "../../lib/schema";
import type { PaymentForm as PaymentFormValues, Tenant } from "../../lib/schema";

type Props = {
  tenants: Tenant[];
  onSubmit: (values: PaymentFormValues) => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function PaymentForm({ tenants, onSubmit, disabled, loading }: Props) {
  const { register, handleSubmit, formState } = useForm<PaymentFormValues>({
    defaultValues: {
      tenant: "",
      amount: 0,
      method: "cash",
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "",
      notes: "",
    },
  });

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
        Notes (Optional)
        <textarea
          rows={3}
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("notes")}
        />
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
    </form>
  );
}
