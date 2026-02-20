import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ID, Query } from "appwrite";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import {
  buildMonthSeries,
  buildPaidByMonth,
  previewAllocation,
} from "../payments/allocation";
import type { House, Payment, Tenant } from "../../lib/schema";
import { useToast } from "../ToastContext";
import { appendRentHistory, buildRentByMonth } from "../../lib/rentHistory";

type HouseRow = {
  HouseCode?: string;
  HouseName?: string;
  MonthlyRent?: number | string;
  RentEffectiveDate?: string;
  Status?: string;
  Notes?: string;
};

type TenantRow = {
  FullName?: string;
  Phone?: string;
  HouseCode?: string;
  MoveInDate?: string;
  MoveOutDate?: string;
  Status?: string;
  RentOverride?: number | string;
  Notes?: string;
  IsMigrated?: string | boolean;
};

type PaymentRow = {
  TenantFullName?: string;
  TenantId?: string;
  HouseCode?: string;
  Amount?: number | string;
  Method?: string;
  PaymentDate?: string;
  Reference?: string;
  Notes?: string;
  IsMigrated?: string | boolean;
};

type ExpenseRow = {
  Category?: string;
  Description?: string;
  Amount?: number | string;
  Source?: string;
  ExpenseDate?: string;
  HouseCode?: string;
  MaintenanceType?: string;
  Notes?: string;
  IsMigrated?: string | boolean;
};

type ParsedData = {
  houses: HouseRow[];
  tenants: TenantRow[];
  payments: PaymentRow[];
  expenses: ExpenseRow[];
};

function normalize(value?: string | number) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseBoolean(value?: string | boolean) {
  if (typeof value === "boolean") return value;
  if (!value) return false;
  return ["true", "yes", "1"].includes(value.toLowerCase());
}

function parseNumber(value?: string | number) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBooleanDefaultTrue(value?: string | boolean) {
  if (value === undefined || value === null || value === "") return true;
  return parseBoolean(value);
}

function parseSheet<T>(workbook: XLSX.WorkBook, name: string): T[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: "" });
}

export default function MigrationPage() {
  const toast = useToast();
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const summary = useMemo(() => {
    if (!parsed) return null;
    return {
      houses: parsed.houses.length,
      tenants: parsed.tenants.length,
      payments: parsed.payments.length,
      expenses: parsed.expenses.length,
    };
  }, [parsed]);

  const handleFile = async (file: File) => {
    setErrors([]);
    setStatus(null);
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const houses = parseSheet<HouseRow>(workbook, "Houses");
    const tenants = parseSheet<TenantRow>(workbook, "Tenants");
    const payments = parseSheet<PaymentRow>(workbook, "Payments");
    const expenses = parseSheet<ExpenseRow>(workbook, "Expenses");
    setParsed({ houses, tenants, payments, expenses });
  };

  const importData = async () => {
    if (!parsed) return;
    setLoading(true);
    setErrors([]);
    setStatus(null);

    const newErrors: string[] = [];

    try {
      const houseResult = await databases.listDocuments(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        [Query.orderAsc("code")]
      );
      const existingHouses = houseResult.documents as unknown as House[];
      const houseByCode = new Map(existingHouses.map((house) => [house.code, house]));
      const houseById = new Map(existingHouses.map((house) => [house.$id, house]));

      for (const row of parsed.houses) {
        const code = normalize(row.HouseCode);
        if (!code) {
          newErrors.push("HouseCode is required for Houses.");
          continue;
        }
        if (houseByCode.has(code)) continue;
        const monthlyRent = parseNumber(row.MonthlyRent);
        const effectiveDate = normalize(row.RentEffectiveDate) || new Date().toISOString().slice(0, 10);
        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.houses,
          ID.unique(),
          {
            code,
            name: normalize(row.HouseName) || null,
            monthlyRent,
            status: normalize(row.Status).toLowerCase() || "vacant",
            notes: normalize(row.Notes) || null,
            rentHistoryJson: appendRentHistory(null, {
              effectiveDate,
              amount: monthlyRent,
              source: "house",
            }),
            isMigrated: true,
          }
        );
        houseByCode.set(code, created as unknown as House);
        houseById.set((created as unknown as House).$id, created as unknown as House);
      }

      const tenantResult = await databases.listDocuments(
        rcmsDatabaseId,
        COLLECTIONS.tenants,
        [Query.orderAsc("fullName")]
      );
      const existingTenants = tenantResult.documents as unknown as Tenant[];
      const tenantKey = (tenant: Tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        return `${tenant.fullName.toLowerCase()}|${houseId}`;
      };
      const tenantByKey = new Map(existingTenants.map((tenant) => [tenantKey(tenant), tenant]));

      for (const row of parsed.tenants) {
        const fullName = normalize(row.FullName);
        const houseCode = normalize(row.HouseCode);
        if (!fullName || !houseCode) {
          newErrors.push("FullName and HouseCode are required for Tenants.");
          continue;
        }
        const house = houseByCode.get(houseCode);
        if (!house) {
          newErrors.push(`HouseCode not found for tenant ${fullName}.`);
          continue;
        }
        const key = `${fullName.toLowerCase()}|${house.$id}`;
        if (tenantByKey.has(key)) continue;
        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.tenants,
          ID.unique(),
          {
            fullName,
            phone: normalize(row.Phone) || null,
            house: house.$id,
            moveInDate: normalize(row.MoveInDate),
            moveOutDate: normalize(row.MoveOutDate) || null,
            status: normalize(row.Status).toLowerCase() || "active",
            rentOverride: parseNumber(row.RentOverride) || null,
            notes: normalize(row.Notes) || null,
            isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
          }
        );
        tenantByKey.set(key, created as unknown as Tenant);
      }

      const tenantById = new Map<string, Tenant>();
      const tenantByName = new Map<string, Tenant>();
      tenantByKey.forEach((tenant) => {
        tenantById.set(tenant.$id, tenant);
        tenantByName.set(tenant.fullName.toLowerCase(), tenant);
      });

      const paymentsByTenant = new Map<string, Payment[]>();
      for (const tenant of tenantByKey.values()) {
        const existing = await databases.listDocuments(
          rcmsDatabaseId,
          COLLECTIONS.payments,
          [Query.equal("tenant", tenant.$id)]
        );
        paymentsByTenant.set(tenant.$id, existing.documents as unknown as Payment[]);
      }

      const sortedPayments = [...parsed.payments].sort((a, b) =>
        normalize(a.PaymentDate).localeCompare(normalize(b.PaymentDate))
      );

      for (const row of sortedPayments) {
        const tenantId = normalize(row.TenantId);
        const tenantName = normalize(row.TenantFullName).toLowerCase();
        const tenant = tenantId
          ? tenantById.get(tenantId)
          : tenantByName.get(tenantName);
        if (!tenant) {
          newErrors.push(`Tenant not found for payment: ${row.TenantFullName}`);
          continue;
        }
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const houseFromRow = houseByCode.get(normalize(row.HouseCode));
        const house = houseFromRow ?? houseById.get(houseId);
        const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;

        const existingPayments = paymentsByTenant.get(tenant.$id) ?? [];
        const paidByMonth = buildPaidByMonth(existingPayments);
        const months = buildMonthSeries(
          tenant.moveInDate,
          normalize(row.PaymentDate),
          24
        );
        const rentByMonth = buildRentByMonth({
          months,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: rent,
        });
        const allocation = previewAllocation({
          amount: parseNumber(row.Amount),
          months,
          paidByMonth,
          rentByMonth,
        });

        const allocationJson = JSON.stringify(
          Object.fromEntries(
            allocation.lines
              .filter((line) => line.applied > 0)
              .map((line) => [line.month, line.applied])
          )
        );

        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.payments,
          ID.unique(),
          {
            tenant: tenant.$id,
            amount: parseNumber(row.Amount),
            method: normalize(row.Method).toLowerCase() || "cash",
            paymentDate: normalize(row.PaymentDate),
            reference: normalize(row.Reference) || null,
            notes: normalize(row.Notes) || null,
            allocationJson,
            isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
          }
        );
        paymentsByTenant.set(
          tenant.$id,
          [created as unknown as Payment, ...existingPayments]
        );
      }

      for (const row of parsed.expenses) {
        const category = normalize(row.Category).toLowerCase();
        if (!category) {
          newErrors.push("Category is required for Expenses.");
          continue;
        }
        const houseId =
          category === "maintenance"
            ? houseByCode.get(normalize(row.HouseCode))?.$id ?? null
            : null;
        if (category === "maintenance" && !houseId) {
          newErrors.push("HouseCode is required for maintenance expenses.");
          continue;
        }
        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.expenses,
          ID.unique(),
          {
            category,
            description: normalize(row.Description),
            amount: parseNumber(row.Amount),
            source: normalize(row.Source).toLowerCase() || "rent_cash",
            expenseDate: normalize(row.ExpenseDate),
            house: houseId,
            maintenanceType: normalize(row.MaintenanceType) || null,
            notes: normalize(row.Notes) || null,
            isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
          }
        );
        if (!created) {
          newErrors.push("Failed to create expense.");
        }
      }

      setErrors(newErrors);
      setStatus(
        newErrors.length === 0
          ? "Import complete."
          : "Import completed with warnings."
      );
      if (newErrors.length === 0) {
        toast.push("success", "Import complete.");
      } else {
        toast.push("warning", "Import completed with warnings.");
      }
    } catch (err) {
      setErrors([`Import failed: ${String(err)}`]);
      toast.push("error", "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Migration</div>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Historical Data Import
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload an Excel workbook with the required sheets.
        </p>
      </header>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="text-sm font-semibold text-slate-100">
          Upload Excel Workbook
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Sheets: Houses, Tenants, Payments, Expenses
        </div>
        <input
          type="file"
          accept=".xlsx"
          className="mt-4 text-sm text-slate-300"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFile(file);
            }
          }}
        />
        {summary && (
          <div className="mt-4 grid gap-4 text-sm text-slate-300 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              Houses: {summary.houses}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              Tenants: {summary.tenants}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              Payments: {summary.payments}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              Expenses: {summary.expenses}
            </div>
          </div>
        )}
        <button
          onClick={importData}
          disabled={!parsed || loading}
          className="btn-primary mt-6 text-sm disabled:opacity-60"
        >
          {loading ? "Importing..." : "Start Import"}
        </button>
        {status && <div className="mt-4 text-sm text-slate-300">{status}</div>}
        {errors.length > 0 && (
          <div className="mt-4 space-y-2 text-sm text-rose-200">
            {errors.map((err) => (
              <div key={err} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                {err}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="text-sm font-semibold text-slate-100">
          Manual Migration
        </div>
        <div className="mt-2 text-sm text-slate-400">
          You can also add historical records manually using the Houses, Tenants,
          Payments, and Expenses screens. Use the original transaction dates and
          add a note that the entry is migrated.
        </div>
      </div>
    </section>
  );
}
