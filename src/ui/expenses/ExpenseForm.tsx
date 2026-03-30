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

type HouseOption = {
  value: string;
  label: string;
  keywords: string;
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
      const initialCategory =
        (initialValues.category ?? emptyValues.category) as ExpenseFormValues["category"];
      const initialHouseValue = normalizeRelationValue(initialValues.house);
      let normalizedHouseValue = initialHouseValue;
      let initialHouseLabel = "";
      if (initialCategory === "maintenance") {
        const matchedHouse = houses.find((house) => house.$id === initialHouseValue);
        initialHouseLabel = matchedHouse ? formatHouseLabel(matchedHouse) : "";
      } else {
        const matchedHouse = houses.find((house) => house.$id === initialHouseValue);
        if (matchedHouse) {
          const label = matchedHouse.name?.trim() || matchedHouse.code?.trim() || "";
          normalizedHouseValue = label;
          initialHouseLabel = label;
        } else {
          initialHouseLabel = initialHouseValue;
        }
      }
      reset({
        ...emptyValues,
        ...initialValues,
        category: initialCategory,
        house: normalizedHouseValue,
        maintenanceType: initialValues.maintenanceType ?? "",
        affectsSecurityDeposit: Boolean(initialValues.affectsSecurityDeposit),
        securityDepositDeductionNote: initialValues.securityDepositDeductionNote ?? "",
        notes: initialValues.notes ?? "",
      });
      setHouseQuery(initialHouseLabel);
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
  const isMaintenance = category === "maintenance";
  const affectsSecurityDeposit = watch("affectsSecurityDeposit");
  const selectedHouseId = watch("house");
  const selectedReceipt = watch("receiptFile");
  const hasSelectedReceipt = Boolean(selectedReceipt && selectedReceipt.length > 0);
  const houseOptions = useMemo<HouseOption[]>(() => {
    if (isMaintenance) {
      return houses.map((house) => {
        const label = formatHouseLabel(house);
        const keywords = [house.code, house.name].filter(Boolean).join(" ").toLowerCase();
        return { value: house.$id, label, keywords };
      });
    }
    const grouped = new Map<string, HouseOption>();
    houses.forEach((house) => {
      const label = house.name?.trim() || house.code?.trim();
      if (!label) return;
      const key = label.toLowerCase();
      if (grouped.has(key)) return;
      const keywords = [house.name, house.code].filter(Boolean).join(" ").toLowerCase();
      grouped.set(key, { value: label, label, keywords });
    });
    return Array.from(grouped.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [houses, isMaintenance]);
  const selectedHouseLabel = useMemo(() => {
    if (!selectedHouseId) return "";
    if (!isMaintenance) return selectedHouseId;
    const matchedOption = houseOptions.find((option) => option.value === selectedHouseId);
    return matchedOption?.label ?? "";
  }, [houseOptions, isMaintenance, selectedHouseId]);
  const filteredHouseOptions = useMemo(() => {
    const normalizedQuery = houseQuery.trim().toLowerCase();
    const source =
      normalizedQuery.length === 0
        ? houseOptions
        : houseOptions.filter(
            (option) =>
              option.label.toLowerCase().includes(normalizedQuery) ||
              option.keywords.includes(normalizedQuery)
          );
    return source.slice(0, 12);
  }, [houseOptions, houseQuery]);

  useEffect(() => {
    if (!isMaintenance) {
      setValue("affectsSecurityDeposit", false);
      setValue("securityDepositDeductionNote", "");
    }
    if (isMaintenance) {
      const matchedHouse = houses.find((house) => house.$id === selectedHouseId);
      if (selectedHouseId && !matchedHouse) {
        setValue("house", "", { shouldDirty: true, shouldValidate: true });
        setHouseQuery("");
      } else if (matchedHouse) {
        setHouseQuery(formatHouseLabel(matchedHouse));
      }
    } else if (selectedHouseId) {
      const matchedHouse = houses.find((house) => house.$id === selectedHouseId);
      if (matchedHouse) {
        const label = matchedHouse.name?.trim() || matchedHouse.code?.trim() || "";
        if (label && label !== selectedHouseId) {
          setValue("house", label, { shouldDirty: true, shouldValidate: true });
        }
        setHouseQuery(label);
      } else {
        setHouseQuery(selectedHouseId);
      }
    }
    setHousePickerOpen(false);
    setHighlightedHouseIndex(-1);
  }, [houses, isMaintenance, selectedHouseId, setValue]);

  useEffect(() => {
    if (!isMaintenance) return;
    if (affectsSecurityDeposit) return;
    setValue("securityDepositDeductionNote", "");
  }, [affectsSecurityDeposit, isMaintenance, setValue]);

  useEffect(() => {
    if (houseQuery.trim()) return;
    if (!selectedHouseId) return;
    if (!isMaintenance) {
      setHouseQuery(selectedHouseId);
      return;
    }
    const selectedHouse = houses.find((house) => house.$id === selectedHouseId);
    if (selectedHouse) {
      setHouseQuery(formatHouseLabel(selectedHouse));
    }
  }, [houses, houseQuery, isMaintenance, selectedHouseId]);

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

      <label className="block text-sm text-slate-300">
        {isMaintenance ? "House" : "House (Optional)"}
        <div className="relative mt-2" ref={housePickerRef}>
          <input
            type="search"
            className="input-base w-full rounded-md px-3 py-2 text-sm"
            placeholder={isMaintenance ? "Search house by code or name" : "Search house name"}
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
                  if (filteredHouseOptions.length === 0) return -1;
                  if (previous >= filteredHouseOptions.length - 1) return 0;
                  return previous + 1;
                });
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedHouseIndex((previous) => {
                  if (filteredHouseOptions.length === 0) return -1;
                  if (previous <= 0) return filteredHouseOptions.length - 1;
                  return previous - 1;
                });
                return;
              }
              if (event.key === "Enter" && highlightedHouseIndex >= 0) {
                event.preventDefault();
                const selected = filteredHouseOptions[highlightedHouseIndex];
                if (!selected) return;
                setValue("house", selected.value, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                setHouseQuery(selected.label);
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
          <input type="hidden" {...register("house", { required: isMaintenance })} />
          {housePickerOpen && (
            <div
              className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-slate-900 shadow-xl"
              style={{ borderColor: "var(--border)" }}
            >
              {filteredHouseOptions.map((house, index) => {
                const label = house.label;
                return (
                  <button
                    key={`${house.value}-${label}`}
                    type="button"
                    className={[
                      "block w-full px-3 py-2 text-left text-sm",
                      highlightedHouseIndex === index
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-200 hover:bg-slate-800/70",
                    ].join(" ")}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setValue("house", house.value, {
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
              {filteredHouseOptions.length === 0 && (
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
            : isMaintenance
              ? "Pick a house from suggestions."
              : "Assign a house name only if this general expense is split by block."}
        </div>
      </label>

      {isMaintenance && (
        <label className="block text-sm text-slate-300">
          Maintenance Type
          <input
            className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            placeholder="Electrical, Plumbing, Painting..."
            {...register("maintenanceType")}
          />
        </label>
      )}

      {isMaintenance && (
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
      {formState.errors.house && isMaintenance && (
        <p className="text-sm text-rose-300">House is required for maintenance.</p>
      )}
    </form>
  );
}
