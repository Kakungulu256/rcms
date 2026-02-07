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
};

export default function ExpenseForm({ houses, onSubmit, disabled, loading }: Props) {
  const { register, handleSubmit, watch, formState } =
    useForm<ExpenseFormValues>({
      defaultValues: {
        category: "general",
        description: "",
        amount: 0,
        source: "rent_cash",
        expenseDate: new Date().toISOString().slice(0, 10),
        house: "",
        maintenanceType: "",
        notes: "",
      },
    });

  const category = watch("category");

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

      <button
        type="submit"
        disabled={disabled}
        className="btn-primary w-full text-sm disabled:opacity-60"
      >
        {loading ? "Recording..." : "Record Expense"}
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
