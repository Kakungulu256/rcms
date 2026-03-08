import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import TypeaheadSearch from "../TypeaheadSearch";
import { listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type { House, SecurityDepositDeduction, Tenant } from "../../lib/schema";
import { formatDisplayDate } from "../../lib/dateDisplay";
import { formatAmount } from "../../lib/numberFormat";

type RefundFilter = "all" | "refunded" | "not_refunded";
type BalanceFilter = "all" | "pending" | "cleared";

type DepositRow = {
  tenantId: string;
  tenantName: string;
  houseLabel: string;
  moveInDate: string;
  moveOutDate?: string;
  required: number;
  paid: number;
  balance: number;
  refunded: boolean;
  relatedDeductions: number;
  relatedDeductionCount: number;
  relatedDeductionItems: string[];
};

function resolveTenantHouseId(tenant: Tenant) {
  if (typeof tenant.house === "string") return tenant.house;
  return tenant.house?.$id ?? "";
}

export default function SecurityDepositsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [deductions, setDeductions] = useState<SecurityDepositDeduction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refundFilter, setRefundFilter] = useState<RefundFilter>("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantResult, houseResult] = await Promise.all([
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [Query.orderAsc("fullName")],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [Query.orderAsc("code")],
        }),
      ]);
      let deductionResult: SecurityDepositDeduction[] = [];
      try {
        deductionResult = await listAllDocuments<SecurityDepositDeduction>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.securityDepositDeductions,
          queries: [Query.orderDesc("deductionDate")],
        });
      } catch {
        setError(
          "Security deposit deductions ledger is unavailable. Run provisioning to create the ledger collection."
        );
      }
      setTenants(tenantResult);
      setHouses(houseResult);
      setDeductions(deductionResult);
    } catch {
      setError("Failed to load security deposit data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const deductionsByTenant = useMemo(() => {
    const map = new Map<string, SecurityDepositDeduction[]>();
    deductions.forEach((deduction) => {
      const group = map.get(deduction.tenantId) ?? [];
      group.push(deduction);
      map.set(deduction.tenantId, group);
    });
    return map;
  }, [deductions]);

  const depositRows = useMemo<DepositRow[]>(() => {
    const rows: DepositRow[] = [];
    tenants.forEach((tenant) => {
      const requiredFlag = Boolean(tenant.securityDepositRequired);
      const required = Math.max(Number(tenant.securityDepositAmount) || 0, 0);
      const paid = Math.max(Number(tenant.securityDepositPaid) || 0, 0);
      const balance = Math.max(Number(tenant.securityDepositBalance) || 0, 0);
      const refunded = Boolean(tenant.securityDepositRefunded);
      const hasDepositRecord = requiredFlag || required > 0 || paid > 0 || balance > 0 || refunded;
      if (!hasDepositRecord) return;

      const houseId = resolveTenantHouseId(tenant);
      const house = houseLookup.get(houseId);
      const houseLabel = house
        ? `${house.code}${house.name?.trim() ? ` - ${house.name.trim()}` : ""}`
        : "Unassigned";

      const tenantDeductions = (deductionsByTenant.get(tenant.$id) ?? [])
        .slice()
        .sort((a, b) => String(a.deductionDate).localeCompare(String(b.deductionDate)));
      const relatedDeductions = tenantDeductions.reduce(
        (sum, deduction) => sum + (Number(deduction.amount) || 0),
        0
      );

      rows.push({
        tenantId: tenant.$id,
        tenantName: tenant.fullName,
        houseLabel,
        moveInDate: tenant.moveInDate,
        moveOutDate: tenant.moveOutDate,
        required,
        paid,
        balance,
        refunded,
        relatedDeductions,
        relatedDeductionCount: tenantDeductions.length,
        relatedDeductionItems: tenantDeductions.map((deduction) => {
          const note = deduction.deductionNote?.trim();
          const base = `${formatDisplayDate(deduction.deductionDate)} - ${deduction.itemFixed}`;
          return note ? `${base} (${note})` : base;
        }),
      });
    });
    return rows.sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }, [deductionsByTenant, houseLookup, tenants]);

  const searchSuggestions = useMemo(() => {
    const values = new Set<string>();
    depositRows.forEach((row) => {
      values.add(row.tenantName);
      if (row.houseLabel.trim()) values.add(row.houseLabel.trim());
      values.add(row.refunded ? "refunded" : "not refunded");
      values.add(row.balance > 0 ? "pending" : "cleared");
    });
    return Array.from(values);
  }, [depositRows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return depositRows.filter((row) => {
      if (refundFilter === "refunded" && !row.refunded) return false;
      if (refundFilter === "not_refunded" && row.refunded) return false;
      if (balanceFilter === "pending" && row.balance <= 0) return false;
      if (balanceFilter === "cleared" && row.balance > 0) return false;
      if (!normalizedQuery) return true;
      const refundLabel = row.refunded ? "refunded" : "not refunded";
      const balanceLabel = row.balance > 0 ? "pending" : "cleared";
      return [
        row.tenantName,
        row.houseLabel,
        refundLabel,
        balanceLabel,
        row.moveInDate?.slice(0, 10) ?? "",
        row.moveOutDate?.slice(0, 10) ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [balanceFilter, depositRows, query, refundFilter]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        const refundable = row.refunded ? 0 : Math.max(row.paid - row.relatedDeductions, 0);
        const held = row.refunded ? 0 : refundable;
        acc.required += row.required;
        acc.paid += row.paid;
        acc.held += held;
        acc.deducted += row.relatedDeductions;
        acc.refundable += refundable;
        return acc;
      },
      { required: 0, paid: 0, held: 0, deducted: 0, refundable: 0 }
    );
  }, [filteredRows]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">Security Deposits</div>
          <h3 className="mt-2 text-xl font-semibold text-white">Deposit Ledger</h3>
          <p className="mt-1 text-sm text-slate-500">
            Track required deposits, paid amounts, balances, refunds, and related deductions.
          </p>
        </div>
        <button onClick={loadData} className="btn-secondary text-sm">
          Refresh
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="text-xs text-slate-500">Total Required</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatAmount(totals.required)}</div>
        </article>
        <article className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="text-xs text-slate-500">Total Paid</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatAmount(totals.paid)}</div>
        </article>
        <article className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="text-xs text-slate-500">Total Held</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatAmount(totals.held)}</div>
        </article>
        <article className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="text-xs text-slate-500">Total Deducted</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatAmount(totals.deducted)}</div>
        </article>
        <article className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="text-xs text-slate-500">Total Refundable</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatAmount(totals.refundable)}</div>
        </article>
      </div>

      <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <TypeaheadSearch
          label="Find Deposit Record"
          placeholder="Search by tenant, house, status, or date"
          query={query}
          suggestions={searchSuggestions}
          onQueryChange={setQuery}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">
            Refund Status
            <select
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              value={refundFilter}
              onChange={(event) => setRefundFilter(event.target.value as RefundFilter)}
            >
              <option value="all">All</option>
              <option value="not_refunded">Not Refunded</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Deposit Balance
            <select
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              value={balanceFilter}
              onChange={(event) => setBalanceFilter(event.target.value as BalanceFilter)}
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <table className="min-w-[1100px] w-full text-left text-sm">
          <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">House</th>
              <th className="px-4 py-3">Move-in</th>
              <th className="px-4 py-3">Move-out</th>
              <th className="px-4 py-3">Required</th>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Related Deductions</th>
              <th className="px-4 py-3">Refund Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.tenantId} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-4 py-3 text-slate-200">{row.tenantName}</td>
                <td className="px-4 py-3 text-slate-300">{row.houseLabel}</td>
                <td className="px-4 py-3 text-slate-300">{formatDisplayDate(row.moveInDate)}</td>
                <td className="px-4 py-3 text-slate-300">{formatDisplayDate(row.moveOutDate)}</td>
                <td className="amount px-4 py-3 text-slate-200">{formatAmount(row.required)}</td>
                <td className="amount px-4 py-3 text-slate-200">{formatAmount(row.paid)}</td>
                <td className="amount px-4 py-3 text-slate-200">{formatAmount(row.balance)}</td>
                <td className="px-4 py-3 text-slate-300">
                  <div className="amount font-medium text-slate-200">{formatAmount(row.relatedDeductions)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.relatedDeductionCount} ledger deduction(s)
                  </div>
                  {row.relatedDeductionItems.length > 0 && (
                    <div className="mt-2 max-w-xs space-y-1 text-xs text-slate-500">
                      {row.relatedDeductionItems.slice(0, 2).map((item) => (
                        <div key={item} className="truncate" title={item}>
                          {item}
                        </div>
                      ))}
                      {row.relatedDeductionItems.length > 2 && (
                        <div>+{row.relatedDeductionItems.length - 2} more</div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={[
                      "rounded-full border px-2 py-1 text-xs",
                      row.refunded
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200",
                    ].join(" ")}
                  >
                    {row.refunded ? "Refunded" : "Not Refunded"}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                  No security deposit records found for the current filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                  Loading deposit records...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
