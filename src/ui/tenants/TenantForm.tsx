import { useForm } from "react-hook-form";
import { TENANT_STATUS } from "../../lib/schema";
import type { House, Tenant, TenantForm as TenantFormValues } from "../../lib/schema";

type TenantFormWithEffectiveDate = TenantFormValues & {
  rentEffectiveDate?: string;
};

type Props = {
  houses: House[];
  initial?: Tenant | null;
  onSubmit: (values: TenantFormWithEffectiveDate) => void;
  onCancel: () => void;
  disabled?: boolean;
  loading?: boolean;
};

function toDateInput(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

export default function TenantForm({
  houses,
  initial,
  onSubmit,
  onCancel,
  disabled,
  loading,
}: Props) {
  const { register, handleSubmit, formState, setValue, watch } =
    useForm<TenantFormWithEffectiveDate>({
    defaultValues: {
      fullName: initial?.fullName ?? "",
      phone: initial?.phone ?? "",
      house: typeof initial?.house === "string" ? initial.house : initial?.house?.$id ?? "",
      moveInDate: toDateInput(initial?.moveInDate) ?? "",
      moveOutDate: toDateInput(initial?.moveOutDate) ?? "",
      status: initial?.status ?? "active",
      rentOverride: initial?.rentOverride ?? undefined,
      notes: initial?.notes ?? "",
      rentEffectiveDate: toDateInput(initial?.moveInDate) ?? new Date().toISOString().slice(0, 10),
    },
  });

  const rentOverride = watch("rentOverride");

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <label className="block text-sm text-slate-300">
        Full Name
        <input
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          placeholder="Jane Doe"
          {...register("fullName", { required: true })}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Phone
          <input
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="0700 000 000"
            {...register("phone")}
          />
        </label>
        <label className="block text-sm text-slate-300">
          House Assignment
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("house", { required: true })}
          >
            <option value="" disabled>
              Select a house
            </option>
            {houses.map((house) => (
              <option key={house.$id} value={house.$id}>
                {house.code} {house.name ? `- ${house.name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Move-in Date
          <input
            type="date"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("moveInDate", { required: true })}
          />
        </label>
        <label className="block text-sm text-slate-300">
          Move-out Date
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              className="input-base w-full rounded-md px-3 py-2 text-sm"
              {...register("moveOutDate")}
            />
            <button
              type="button"
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300"
              onClick={() => {
                setValue("moveOutDate", "");
              }}
            >
              Clear
            </button>
          </div>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Status
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("status", { required: true })}
          >
            {TENANT_STATUS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Rent Override (Optional)
          <input
            type="number"
            step="0.01"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("rentOverride", { valueAsNumber: true })}
          />
        </label>
      </div>
      {rentOverride ? (
        <label className="block text-sm text-slate-300">
          Rent Override Effective Date
          <input
            type="date"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("rentEffectiveDate")}
          />
        </label>
      ) : null}

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
          {loading ? "Saving..." : initial ? "Save Changes" : "Create Tenant"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
      </div>
      {formState.errors.fullName && (
        <p className="text-sm text-rose-300">Tenant name is required.</p>
      )}
      {formState.errors.house && (
        <p className="text-sm text-rose-300">House assignment is required.</p>
      )}
      {formState.errors.moveInDate && (
        <p className="text-sm text-rose-300">Move-in date is required.</p>
      )}
    </form>
  );
}
