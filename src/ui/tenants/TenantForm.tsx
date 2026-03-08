import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { TENANT_STATUS, TENANT_TYPES } from "../../lib/schema";
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
  const [houseSearch, setHouseSearch] = useState("");
  const { register, handleSubmit, formState, setValue, watch } =
    useForm<TenantFormWithEffectiveDate>({
    defaultValues: {
      fullName: initial?.fullName ?? "",
      phone: initial?.phone ?? "",
      house: typeof initial?.house === "string" ? initial.house : initial?.house?.$id ?? "",
      moveInDate: toDateInput(initial?.moveInDate) ?? "",
      moveOutDate: toDateInput(initial?.moveOutDate) ?? "",
      status: initial?.status ?? "active",
      tenantType: initial?.tenantType ?? (initial ? "old" : "new"),
      rentOverride: initial?.rentOverride ?? undefined,
      notes: initial?.notes ?? "",
      rentEffectiveDate: toDateInput(initial?.moveInDate) ?? new Date().toISOString().slice(0, 10),
    },
  });

  const rentOverride = watch("rentOverride");
  const moveOutDate = watch("moveOutDate");
  const status = watch("status");
  const selectedHouseId = watch("house");
  const filteredHouses = useMemo(() => {
    const query = houseSearch.trim().toLowerCase();
    if (!query) return houses;
    const matches = houses.filter((house) => {
      const code = house.code?.toLowerCase() ?? "";
      const name = house.name?.toLowerCase() ?? "";
      return code.includes(query) || name.includes(query);
    });
    if (!selectedHouseId) return matches;
    const hasSelected = matches.some((house) => house.$id === selectedHouseId);
    if (hasSelected) return matches;
    const selected = houses.find((house) => house.$id === selectedHouseId);
    return selected ? [selected, ...matches] : matches;
  }, [houseSearch, houses, selectedHouseId]);

  useEffect(() => {
    if (!moveOutDate?.trim()) return;
    setValue("status", "inactive", { shouldDirty: true, shouldValidate: true });
  }, [moveOutDate, setValue]);

  useEffect(() => {
    if (status !== "inactive") return;
    if (moveOutDate?.trim()) return;
    setValue("moveOutDate", new Date().toISOString().slice(0, 10), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [moveOutDate, setValue, status]);

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
          <input
            type="search"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="Search house by code or name"
            value={houseSearch}
            onChange={(event) => setHouseSearch(event.target.value)}
          />
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("house", { required: true })}
          >
            <option value="" disabled>
              Select a house
            </option>
            {filteredHouses.map((house) => (
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
          Move-out Date (Optional)
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
                setValue("status", "active", { shouldDirty: true, shouldValidate: true });
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
            disabled={Boolean(moveOutDate?.trim()) || disabled}
          >
            {TENANT_STATUS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          {moveOutDate?.trim() && (
            <p className="mt-2 text-xs text-slate-500">
              Status is set to inactive when move-out date is provided.
            </p>
          )}
        </label>
        <label className="block text-sm text-slate-300">
          Tenant Type
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("tenantType", { required: true })}
          >
            {TENANT_TYPES.map((tenantType) => (
              <option key={tenantType} value={tenantType}>
                {tenantType === "new" ? "New" : "Old"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Custom Rent (Optional)
          <input
            type="number"
            step="0.01"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("rentOverride", { valueAsNumber: true })}
          />
          <p className="mt-2 text-xs text-slate-500">
            Use this only if this tenant pays a different monthly rent than the house default.
          </p>
        </label>
      </div>
      {rentOverride ? (
        <label className="block text-sm text-slate-300">
          Custom Rent Start Date
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
