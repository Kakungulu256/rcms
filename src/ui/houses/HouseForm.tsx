import { useForm } from "react-hook-form";
import type { House, HouseForm as HouseFormValues } from "../../lib/schema";
import { useToast } from "../ToastContext";

type HouseFormWithEffectiveDate = HouseFormValues & {
  rentEffectiveDate?: string;
};

type Props = {
  initial?: House | null;
  onSubmit: (values: HouseFormWithEffectiveDate) => void;
  onCancel: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function HouseForm({
  initial,
  onSubmit,
  onCancel,
  disabled,
  loading,
}: Props) {
  const toast = useToast();
  const { register, handleSubmit, formState } = useForm<HouseFormWithEffectiveDate>({
    defaultValues: {
      code: initial?.code ?? "",
      name: initial?.name ?? "",
      monthlyRent: initial?.monthlyRent ?? 0,
      status: initial?.status === "inactive" ? "inactive" : "vacant",
      notes: initial?.notes ?? "",
      rentEffectiveDate: new Date().toISOString().slice(0, 7),
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(onSubmit, () => {
        toast.push("warning", "Please fill in all required house fields correctly.");
      })}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          House Code
          <input
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="A-101"
            {...register("code", { required: true })}
          />
        </label>
        <label className="block text-sm text-slate-300">
          House Name
          <input
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="Block A - 101"
            {...register("name")}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm text-slate-300">
        Monthly Rent
        <input
          type="number"
            step="0.01"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("monthlyRent", { required: true, valueAsNumber: true })}
          />
        </label>
        <label className="block text-sm text-slate-300">
          Rent Effective Month
          <input
            type="month"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("rentEffectiveDate")}
          />
        </label>
        <label className="block text-sm text-slate-300">
          Manual Availability
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("status", { required: true })}
          >
            <option value="vacant">vacant</option>
            <option value="inactive">inactive</option>
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Occupied or vacant is set automatically by tenant assignment.
            Choose inactive only when this house should not be rented.
          </p>
        </label>
      </div>

      <label className="block text-sm text-slate-300">
        Notes
        <textarea
          rows={3}
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("notes")}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="btn-primary text-sm disabled:opacity-60"
        >
          {loading ? "Saving..." : initial ? "Save Changes" : "Create House"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
      </div>
      {formState.errors.code && (
        <p className="text-sm text-rose-300">House code is required.</p>
      )}
      {formState.errors.monthlyRent && (
        <p className="text-sm text-rose-300">Monthly rent is required.</p>
      )}
    </form>
  );
}
