import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SOURCES,
} from "../../lib/schema";
import type { ExpenseForm as ExpenseFormValues, House } from "../../lib/schema";

type Props = {
  houses: House[];
  onSubmit: (values: ExpenseFormValues) => void;
  disabled?: boolean;
  loading?: boolean;
  initialValues?: Partial<ExpenseFormValues> | null;
  submitLabel?: string;
  currentReceipt?: {
    url: string;
    name: string;
    size?: number;
  } | null;
};

function buildEmptyValues(): ExpenseFormValues {
  return {
    category: "general",
    description: "",
    amount: 0,
    source: "rent_cash",
    expenseDate: new Date().toISOString().slice(0, 10),
    house: "",
    maintenanceType: "",
    notes: "",
    removeReceipt: false,
  };
}

function normalizeRelationValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "$id" in value &&
    typeof (value as { $id?: unknown }).$id === "string"
  ) {
    return (value as { $id: string }).$id;
  }
  return "";
}

export default function ExpenseForm({
  houses,
  onSubmit,
  disabled,
  loading,
  initialValues,
  submitLabel,
  currentReceipt,
}: Props) {
  const { register, handleSubmit, watch, formState, reset, setValue } =
    useForm<ExpenseFormValues>({
      defaultValues: buildEmptyValues(),
    });

  useEffect(() => {
    const emptyValues = buildEmptyValues();
    if (initialValues) {
      reset({
        ...emptyValues,
        ...initialValues,
        house: normalizeRelationValue(initialValues.house),
        maintenanceType: initialValues.maintenanceType ?? "",
        notes: initialValues.notes ?? "",
      });
      return;
    }
    reset(emptyValues);
  }, [initialValues, reset]);

  const category = watch("category");
  const selectedReceipt = watch("receiptFile");
  const hasSelectedReceipt = Boolean(selectedReceipt && selectedReceipt.length > 0);

  const formatFileSize = (bytes?: number) => {
    const size = Number(bytes ?? 0);
    if (!Number.isFinite(size) || size <= 0) return "--";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <label className="block text-sm text-slate-300">
        Category
        <select
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("category", { required: true })}
        >
          {EXPENSE_CATEGORIES.map((categoryOption) => (
            <option key={categoryOption} value={categoryOption}>
              {categoryOption === "general" ? "General" : "Maintenance"}
            </option>
          ))}
        </select>
      </label>

      {category === "maintenance" && (
        <label className="block text-sm text-slate-300">
          House
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("house", { required: category === "maintenance" })}
          >
            <option value="" disabled>
              Select house
            </option>
            {houses.map((house) => (
              <option key={house.$id} value={house.$id}>
                {house.code} {house.name ? `- ${house.name}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {category === "maintenance" && (
        <label className="block text-sm text-slate-300">
          Maintenance Type
          <input
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="Electrical, Plumbing, Painting..."
            {...register("maintenanceType")}
          />
        </label>
      )}

      <label className="block text-sm text-slate-300">
        Description
        <input
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          placeholder="Gateman salary"
          {...register("description", { required: true })}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Amount
          <input
            type="number"
            step="0.01"
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("amount", { required: true, valueAsNumber: true })}
          />
        </label>
        <label className="block text-sm text-slate-300">
          Source of Funds
          <select
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            {...register("source", { required: true })}
          >
            {EXPENSE_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source === "rent_cash" ? "Rent Cash" : "External"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm text-slate-300">
        Expense Date
        <input
          type="date"
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("expenseDate", { required: true })}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Notes
        <textarea
          rows={3}
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
          {...register("notes")}
        />
      </label>

      <label className="block text-sm text-slate-300">
        Receipt Upload (Optional)
        {currentReceipt && (
          <div className="mt-2 rounded-md border border-slate-700/60 bg-slate-950/40 p-3 text-xs text-slate-400">
            Current:{" "}
            <a
              href={currentReceipt.url}
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline"
            >
              {currentReceipt.name || "View receipt"}
            </a>{" "}
            <span className="text-slate-500">({formatFileSize(currentReceipt.size)})</span>
          </div>
        )}
        <input
          type="file"
          accept=".pdf,image/*"
          className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-xs file:text-slate-100"
          {...register("receiptFile", {
            onChange: (event) => {
              if (event?.target?.files?.length) {
                setValue("removeReceipt", false);
              }
            },
          })}
        />
        {currentReceipt && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-500 bg-slate-900"
              disabled={hasSelectedReceipt}
              {...register("removeReceipt")}
            />
            Remove current receipt
          </label>
        )}
        <span className="mt-1 block text-xs text-slate-500">
          Upload an expense receipt image or PDF. Selecting a new file replaces the current receipt.
        </span>
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="btn-primary w-full text-sm disabled:opacity-60"
      >
        {loading
          ? submitLabel === "Save Changes"
            ? "Saving..."
            : "Recording..."
          : submitLabel ?? "Record Expense"}
      </button>

      {formState.errors.description && (
        <p className="text-sm text-rose-300">Description is required.</p>
      )}
      {formState.errors.amount && (
        <p className="text-sm text-rose-300">Amount is required.</p>
      )}
      {formState.errors.house && category === "maintenance" && (
        <p className="text-sm text-rose-300">House is required for maintenance.</p>
      )}
    </form>
  );
}
