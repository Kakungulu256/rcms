import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { TENANT_STATUS, TENANT_TYPES } from "../../lib/schema";
import TypeaheadField, { type TypeaheadOption } from "../TypeaheadField";
import { useToast } from "../ToastContext";
import type { House, Tenant, TenantForm as TenantFormValues } from "../../lib/schema";

type Props = {
  houses: House[];
  initial?: Tenant | null;
  onSubmit: (values: TenantFormValues) => void;
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
  const toast = useToast();
  const { register, handleSubmit, formState, setValue, watch } =
    useForm<TenantFormValues>({
    defaultValues: {
      fullName: initial?.fullName ?? "",
      phone: initial?.phone ?? "",
      house: typeof initial?.house === "string" ? initial.house : initial?.house?.$id ?? "",
      moveInDate: toDateInput(initial?.moveInDate) ?? "",
      moveOutDate: toDateInput(initial?.moveOutDate) ?? "",
      status: initial?.status ?? "active",
      tenantType: initial?.tenantType ?? (initial ? "old" : "new"),
      notes: initial?.notes ?? "",
    },
  });

  const moveOutDate = watch("moveOutDate");
  const status = watch("status");
  const selectedHouseId = watch("house");
  const currentHouseId = useMemo(
    () =>
      typeof initial?.house === "string"
        ? initial.house
        : initial?.house?.$id ?? "",
    [initial]
  );
  const assignableHouses = useMemo(
    () =>
      houses.filter(
        (house) => house.status === "vacant" || (currentHouseId && house.$id === currentHouseId)
      ),
    [currentHouseId, houses]
  );
  const hasVacantHouses = useMemo(
    () => houses.some((house) => house.status === "vacant"),
    [houses]
  );
  const houseOptions = useMemo<TypeaheadOption[]>(
    () =>
      assignableHouses.map((house) => ({
        id: house.$id,
        label: house.code,
        description: house.name?.trim() || undefined,
        keywords: `${house.code} ${house.name ?? ""}`,
      })),
    [assignableHouses]
  );
  const selectableHouseIds = useMemo(
    () => new Set(assignableHouses.map((house) => house.$id)),
    [assignableHouses]
  );
  const houseField = register("house", {
    required: "House assignment is required.",
    validate: (value) =>
      selectableHouseIds.has(value)
        ? true
        : "Only vacant houses can be assigned.",
  });

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
    <form
      className="space-y-4"
      onSubmit={handleSubmit(onSubmit, () => {
        toast.push("warning", "Please fill in all required tenant fields correctly.");
      })}
    >
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
        <div>
          <TypeaheadField
            label="House Assignment"
            placeholder="Type house code or name"
            value={selectedHouseId}
            options={houseOptions}
            disabled={disabled || houseOptions.length === 0}
            emptyStateText={
              houseOptions.length === 0
                ? "No vacant houses available for assignment."
                : "No house matches your search."
            }
            onChange={(houseId) =>
              setValue("house", houseId, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              })
            }
          />
          <input type="hidden" {...houseField} />
          {!initial && !hasVacantHouses && (
            <p className="mt-2 text-xs text-amber-300">
              No vacant houses are available. Add or free up a vacant house first.
            </p>
          )}
          {initial && houseOptions.length === 0 && (
            <p className="mt-2 text-xs text-amber-300">
              No assignable house is available for this tenant right now.
            </p>
          )}
        </div>
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
        <p className="text-sm text-rose-300">
          {String(formState.errors.house.message ?? "House assignment is required.")}
        </p>
      )}
      {formState.errors.moveInDate && (
        <p className="text-sm text-rose-300">Move-in date is required.</p>
      )}
    </form>
  );
}
