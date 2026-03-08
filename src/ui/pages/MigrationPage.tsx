import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ID, Query } from "appwrite";
import {
  account,
  databases,
  functions as appwriteFunctions,
  listAllDocuments,
  rcmsDatabaseId,
} from "../../lib/appwrite";
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
  TenantType?: string;
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

type MigrationFunctionSuccess = {
  ok: true;
  message?: string;
  warnings?: string[];
  counters?: {
    housesCreated?: number;
    tenantsCreated?: number;
    paymentsCreated?: number;
    expensesCreated?: number;
    housesUpdated?: number;
  };
};

type MigrationFunctionFailure = {
  ok: false;
  error?: string;
};

type MigrationFunctionResult = MigrationFunctionSuccess | MigrationFunctionFailure;

const TEMPLATE_FILE_NAME = "RCMS_Old_Records_Template.xlsx";

function buildTemplateSheet(headers: string[], sample: string[]) {
  return XLSX.utils.aoa_to_sheet([headers, sample]);
}

function downloadMigrationTemplate() {
  const workbook = XLSX.utils.book_new();

  const guide = XLSX.utils.aoa_to_sheet([
    ["RCMS Old Records Upload Template"],
    [""],
    ["How to use"],
    ["1. Keep sheet names exactly: Houses, Tenants, Payments, Expenses."],
    ["2. Keep column headers exactly as provided in row 1."],
    ["3. Use YYYY-MM-DD for all dates."],
    ["4. Required fields: HouseCode, FullName, HouseCode, MoveInDate, Amount, PaymentDate, Category, Description, ExpenseDate."],
    ["5. Allowed values examples:"],
    ["   Houses.Status -> occupied | vacant | inactive"],
    ["   Tenants.Status -> active | inactive"],
    ["   Tenants.TenantType -> new | old"],
    ["   Payments.Method -> cash | bank"],
    ["   Expenses.Category -> general | maintenance"],
    ["   Expenses.Source -> rent_cash | external"],
  ]);
  XLSX.utils.book_append_sheet(workbook, guide, "Guide");

  const houses = buildTemplateSheet(
    ["HouseCode", "HouseName", "MonthlyRent", "RentEffectiveDate", "Status", "Notes"],
    ["A-101", "Block A 101", "450000", "2026-01-01", "vacant", "Optional note"]
  );
  XLSX.utils.book_append_sheet(workbook, houses, "Houses");

  const tenants = buildTemplateSheet(
    [
      "FullName",
      "Phone",
      "HouseCode",
      "MoveInDate",
      "MoveOutDate",
      "Status",
      "TenantType",
      "RentOverride",
      "Notes",
      "IsMigrated",
    ],
    [
      "Jane Doe",
      "+256700000001",
      "A-101",
      "2026-01-01",
      "",
      "active",
      "old",
      "",
      "Optional note",
      "true",
    ]
  );
  XLSX.utils.book_append_sheet(workbook, tenants, "Tenants");

  const payments = buildTemplateSheet(
    [
      "TenantFullName",
      "TenantId",
      "HouseCode",
      "Amount",
      "Method",
      "PaymentDate",
      "Reference",
      "Notes",
      "IsMigrated",
    ],
    [
      "Jane Doe",
      "",
      "A-101",
      "900000",
      "cash",
      "2026-02-01",
      "RCPT-001",
      "Paid at office",
      "true",
    ]
  );
  XLSX.utils.book_append_sheet(workbook, payments, "Payments");

  const expenses = buildTemplateSheet(
    [
      "Category",
      "Description",
      "Amount",
      "Source",
      "ExpenseDate",
      "HouseCode",
      "MaintenanceType",
      "Notes",
      "IsMigrated",
    ],
    [
      "general",
      "Caretaker salary",
      "150000",
      "rent_cash",
      "2026-02-02",
      "",
      "",
      "Optional note",
      "true",
    ]
  );
  XLSX.utils.book_append_sheet(workbook, expenses, "Expenses");

  XLSX.writeFile(workbook, TEMPLATE_FILE_NAME);
}

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

function parseExecutionBody(response?: string): MigrationFunctionResult | null {
  try {
    return response ? (JSON.parse(response) as MigrationFunctionResult) : null;
  } catch {
    return null;
  }
}

async function executeMigrationFunction(
  functionId: string,
  payload: Record<string, unknown>
) {
  const execution = await appwriteFunctions.createExecution(
    functionId,
    JSON.stringify(payload),
    false
  );

  const readBody = (value: unknown) =>
    (value as { responseBody?: string; response?: string }).responseBody ??
    (value as { responseBody?: string; response?: string }).response ??
    "";

  let latest: unknown = execution;
  let body = readBody(latest);
  let attempts = 0;

  while (
    attempts < 10 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    latest = await appwriteFunctions.getExecution(
      functionId,
      (latest as { $id: string }).$id
    );
    body = readBody(latest);
    attempts += 1;
  }

  return {
    parsed: parseExecutionBody(body),
    latest: latest as { errors?: string; status?: string; responseStatusCode?: number },
  };
}

export default function MigrationPage() {
  const toast = useToast();
  const migrateFunctionId = import.meta.env
    .VITE_MIGRATE_HISTORICAL_DATA_FUNCTION_ID as string | undefined;
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

    if (migrateFunctionId) {
      try {
        const jwt = await account.createJWT();
        const { parsed: migrationResult, latest } = await executeMigrationFunction(
          migrateFunctionId,
          {
            jwt: jwt.jwt,
            data: parsed,
          }
        );

        if (!migrationResult || !migrationResult.ok) {
          const message =
            (migrationResult && !migrationResult.ok && migrationResult.error) ||
            latest?.errors ||
            "Upload failed.";
          throw new Error(message);
        }

        const warnings = migrationResult.warnings ?? [];
        const createdSummary = migrationResult.counters
          ? `Houses ${migrationResult.counters.housesCreated ?? 0}, Tenants ${
              migrationResult.counters.tenantsCreated ?? 0
            }, Payments ${migrationResult.counters.paymentsCreated ?? 0}, Expenses ${
              migrationResult.counters.expensesCreated ?? 0
            }`
          : null;

        setErrors(warnings);
        setStatus(
          migrationResult.message ??
            (warnings.length === 0
              ? "Upload complete."
              : "Upload completed with warnings.")
        );

        if (warnings.length === 0) {
          toast.push(
            "success",
            createdSummary ? `Upload complete. ${createdSummary}` : "Upload complete."
          );
        } else {
          toast.push("warning", "Upload completed with warnings.");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        setErrors([`Upload failed: ${message}`]);
        toast.push("error", message);
      } finally {
        setLoading(false);
      }
      return;
    }

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
        const moveOutDate = normalize(row.MoveOutDate) || null;
        const status =
          moveOutDate != null
            ? "inactive"
            : normalize(row.Status).toLowerCase() || "active";
        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.tenants,
          ID.unique(),
          {
            fullName,
            phone: normalize(row.Phone) || null,
            house: house.$id,
            moveInDate: normalize(row.MoveInDate),
            moveOutDate,
            status,
            tenantType: normalize(row.TenantType).toLowerCase() === "new" ? "new" : "old",
            securityDepositRequired: false,
            securityDepositAmount: 0,
            securityDepositPaid: 0,
            securityDepositBalance: 0,
            securityDepositRefunded: false,
            rentOverride: parseNumber(row.RentOverride) || null,
            notes: normalize(row.Notes) || null,
            isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
          }
        );
        tenantByKey.set(key, created as unknown as Tenant);
      }

      for (const [houseCode, house] of houseByCode.entries()) {
        const tenantsForHouse = await listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [Query.equal("house", [house.$id]), Query.orderAsc("fullName")],
        });
        const occupant =
          tenantsForHouse.find((tenant) => tenant.status === "active" && !tenant.moveOutDate) ??
          null;
        const nextStatus = occupant
          ? "occupied"
          : house.status === "inactive"
            ? "inactive"
            : "vacant";
        const nextCurrentTenantId = occupant?.$id ?? null;
        if (
          house.status === nextStatus &&
          (house.currentTenantId ?? null) === nextCurrentTenantId
        ) {
          continue;
        }
        const updatedHouse = (await databases.updateDocument(
          rcmsDatabaseId,
          COLLECTIONS.houses,
          house.$id,
          {
            status: nextStatus,
            currentTenantId: nextCurrentTenantId,
          }
        )) as unknown as House;
        houseByCode.set(houseCode, updatedHouse);
        houseById.set(updatedHouse.$id, updatedHouse);
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
          ? "Upload complete."
          : "Upload completed with warnings."
      );
      if (newErrors.length === 0) {
        toast.push("success", "Upload complete.");
      } else {
        toast.push("warning", "Upload completed with warnings.");
      }
    } catch (err) {
      setErrors([`Upload failed: ${String(err)}`]);
      toast.push("error", "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Old Records</div>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Old Records Upload
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload an Excel file with the required sheets.
        </p>
      </header>

      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-100">
            Upload Excel File
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={downloadMigrationTemplate}
          >
            Download Template
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Sheets: Houses, Tenants, Payments, Expenses
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Use the template to get required columns and examples.
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
          {loading ? "Uploading..." : "Start Upload"}
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
          Manual Entry
        </div>
        <div className="mt-2 text-sm text-slate-400">
          You can also add old records manually using the Houses, Tenants,
          Payments, and Expenses screens. Use the original transaction dates and
          add a note that this entry was back-entered.
        </div>
      </div>
    </section>
  );
}
