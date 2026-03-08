import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SOURCES,
} from "../../lib/schema";
import type { ExpenseForm as ExpenseFormValues, House } from "../../lib/schema";
import { useToast } from "../ToastContext";

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
    affectsSecurityDeposit: false,
    securityDepositDeductionNote: "",
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

function formatHouseLabel(house: House): string {
  const code = house.code?.trim() ?? "";
  const name = house.name?.trim() ?? "";
  if (code && name) return `${code} - ${name}`;
  return code || name || "--";
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
  const toast = useToast();
  const { register, handleSubmit, watch, formState, reset, setValue } =
    useForm<ExpenseFormValues>({
      defaultValues: buildEmptyValues(),
    });
  const housePickerRef = useRef<HTMLDivElement | null>(null);
  const [houseQuery, setHouseQuery] = useState("");
  const [housePickerOpen, setHousePickerOpen] = useState(false);
  const [highlightedHouseIndex, setHighlightedHouseIndex] = useState(-1);

  useEffect(() => {
    const emptyValues = buildEmptyValues();
    if (initialValues) {
      const initialHouseId = normalizeRelationValue(initialValues.house);
      reset({
        ...emptyValues,
        ...initialValues,
        house: initialHouseId,
        maintenanceType: initialValues.maintenanceType ?? "",
        affectsSecurityDeposit: Boolean(initialValues.affectsSecurityDeposit),
        securityDepositDeductionNote: initialValues.securityDepositDeductionNote ?? "",
        notes: initialValues.notes ?? "",
      });
      const matchedHouse = houses.find((house) => house.$id === initialHouseId);
      setHouseQuery(matchedHouse ? formatHouseLabel(matchedHouse) : "");
      setHousePickerOpen(false);
      setHighlightedHouseIndex(-1);
      return;
    }
    reset(emptyValues);
    setHouseQuery("");
    setHousePickerOpen(false);
    setHighlightedHouseIndex(-1);
  }, [houses, initialValues, reset]);

  const category = watch("category");
  const affectsSecurityDeposit = watch("affectsSecurityDeposit");
  const selectedHouseId = watch("house");
  const selectedReceipt = watch("receiptFile");
  const hasSelectedReceipt = Boolean(selectedReceipt && selectedReceipt.length > 0);
  const selectedHouseLabel = useMemo(() => {
    const matchedHouse = houses.find((house) => house.$id === selectedHouseId);
    return matchedHouse ? formatHouseLabel(matchedHouse) : "";
  }, [houses, selectedHouseId]);
  const filteredHouses = useMemo(() => {
    const normalizedQuery = houseQuery.trim().toLowerCase();
    const source =
      normalizedQuery.length === 0
        ? houses
        : houses.filter((house) => {
            const code = house.code?.toLowerCase() ?? "";
            const name = house.name?.toLowerCase() ?? "";
            return code.includes(normalizedQuery) || name.includes(normalizedQuery);
          });
    return source.slice(0, 12);
  }, [houseQuery, houses]);

  useEffect(() => {
    if (category === "maintenance") return;
    setValue("affectsSecurityDeposit", false);
    setValue("securityDepositDeductionNote", "");
    setHousePickerOpen(false);
    setHighlightedHouseIndex(-1);
  }, [category, setValue]);

  useEffect(() => {
    if (category !== "maintenance") return;
    if (affectsSecurityDeposit) return;
    setValue("securityDepositDeductionNote", "");
  }, [affectsSecurityDeposit, category, setValue]);

  useEffect(() => {
    const selectedHouse = houses.find((house) => house.$id === selectedHouseId);
    if (selectedHouse && !houseQuery.trim()) {
      setHouseQuery(formatHouseLabel(selectedHouse));
    }
  }, [houses, houseQuery, selectedHouseId]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!housePickerRef.current) return;
      if (!housePickerRef.current.contains(event.target as Node)) {
        setHousePickerOpen(false);
        setHighlightedHouseIndex(-1);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const formatFileSize = (bytes?: number) => {
    const size = Number(bytes ?? 0);
    if (!Number.isFinite(size) || size <= 0) return "--";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(onSubmit, () => {
        toast.push("warning", "Please fill in all required expense fields correctly.");
      })}
    >
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
          <div className="relative mt-2" ref={housePickerRef}>
            <input
              type="search"
              className="input-base w-full rounded-md px-3 py-2 text-sm"
              placeholder="Search house by code or name"
              value={houseQuery}
              onFocus={() => {
                setHousePickerOpen(true);
                setHighlightedHouseIndex(-1);
              }}
              onChange={(event) => {
                setHouseQuery(event.target.value);
                setValue("house", "", { shouldDirty: true, shouldValidate: true });
                setHousePickerOpen(true);
                setHighlightedHouseIndex(-1);
              }}
              onKeyDown={(event) => {
                if (!housePickerOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  setHousePickerOpen(true);
                  return;
                }
                if (!housePickerOpen) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlightedHouseIndex((previous) => {
                    if (filteredHouses.length === 0) return -1;
                    if (previous >= filteredHouses.length - 1) return 0;
                    return previous + 1;
                  });
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlightedHouseIndex((previous) => {
                    if (filteredHouses.length === 0) return -1;
                    if (previous <= 0) return filteredHouses.length - 1;
                    return previous - 1;
                  });
                  return;
                }
                if (event.key === "Enter" && highlightedHouseIndex >= 0) {
                  event.preventDefault();
                  const selected = filteredHouses[highlightedHouseIndex];
                  if (!selected) return;
                  setValue("house", selected.$id, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setHouseQuery(formatHouseLabel(selected));
                  setHousePickerOpen(false);
                  setHighlightedHouseIndex(-1);
                  return;
                }
                if (event.key === "Escape") {
                  setHousePickerOpen(false);
                  setHighlightedHouseIndex(-1);
                }
              }}
            />
            <input
              type="hidden"
              {...register("house", { required: category === "maintenance" })}
            />
            {housePickerOpen && (
              <div
                className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-slate-900 shadow-xl"
                style={{ borderColor: "var(--border)" }}
              >
                {filteredHouses.map((house, index) => {
                  const label = formatHouseLabel(house);
                  return (
                    <button
                      key={house.$id}
                      type="button"
                      className={[
                        "block w-full px-3 py-2 text-left text-sm",
                        highlightedHouseIndex === index
                          ? "bg-slate-800 text-slate-100"
                          : "text-slate-200 hover:bg-slate-800/70",
                      ].join(" ")}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setValue("house", house.$id, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        setHouseQuery(label);
                        setHousePickerOpen(false);
                        setHighlightedHouseIndex(-1);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
                {filteredHouses.length === 0 && (
                  <div className="px-3 py-2 text-sm text-slate-500">
                    No houses match this search.
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {selectedHouseLabel
              ? `Selected: ${selectedHouseLabel}`
              : "Pick a house from suggestions."}
          </div>
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

      {category === "maintenance" && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-500 bg-slate-900"
              {...register("affectsSecurityDeposit")}
            />
            Affects tenant security deposit
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Check this if the maintenance should be deducted from the occupying tenant&apos;s deposit.
          </p>
          {affectsSecurityDeposit && (
            <label className="mt-3 block text-sm text-slate-300">
              Deposit Deduction Note (Optional)
              <textarea
                rows={2}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                placeholder="What was fixed and why this should affect the deposit"
                {...register("securityDepositDeductionNote")}
              />
            </label>
          )}
        </div>
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
