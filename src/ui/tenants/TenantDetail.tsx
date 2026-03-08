import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import {
  buildMonthSeries,
  buildPaidByMonth,
  buildPaymentSummaryByMonth,
} from "../payments/allocation";
import {
  listAllDocuments,
  rcmsDatabaseId,
} from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type {
  House,
  Payment,
  SecurityDepositDeduction,
  Tenant,
} from "../../lib/schema";
import { buildRentByMonth } from "../../lib/rentHistory";
import { getTenantEffectiveEndDate } from "../../lib/tenancyDates";
import { formatDisplayDate, formatShortMonth } from "../../lib/dateDisplay";
import { formatAmount } from "../../lib/numberFormat";

type Props = {
  tenant?: Tenant | null;
  houses: House[];
  payments: Payment[];
  statusOpen: boolean;
  onOpenStatus: () => void;
  onCloseStatus: () => void;
};

function resolveHouseLabel(tenant: Tenant, houses: House[]) {
  if (typeof tenant.house === "string") {
    const match = houses.find((house) => house.$id === tenant.house);
    return match ? match.code : "--";
  }
  return tenant.house?.code ?? "--";
}

export default function TenantDetail({
  tenant,
  houses,
  payments,
  statusOpen,
  onOpenStatus,
  onCloseStatus,
}: Props) {
  const moveInDate = tenant?.moveInDate ?? null;
  const endDate = tenant ? getTenantEffectiveEndDate(tenant, new Date()) : new Date();
  const months = moveInDate ? buildMonthSeries(moveInDate, endDate) : [];
  const [yearFilter, setYearFilter] = useState(() => new Date().getFullYear());
  const [deductions, setDeductions] = useState<SecurityDepositDeduction[]>([]);
  const [deductionsLoading, setDeductionsLoading] = useState(false);
  const [deductionsError, setDeductionsError] = useState<string | null>(null);

  const houseId =
    typeof tenant?.house === "string" ? tenant.house : tenant?.house?.$id ?? "";
  const house = houses.find((item) => item.$id === houseId);
  const rent = tenant?.rentOverride ?? house?.monthlyRent ?? 0;
  const tenantPayments = tenant
    ? payments.filter((payment) => {
        const paymentTenantId =
          typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
        return paymentTenantId === tenant.$id;
      })
    : [];
  const paidByMonth = buildPaidByMonth(tenantPayments);
  const paymentSummaryByMonth = buildPaymentSummaryByMonth(tenantPayments);
  const rentByMonth = buildRentByMonth({
    months,
    tenantHistoryJson: tenant?.rentHistoryJson ?? null,
    houseHistoryJson: house?.rentHistoryJson ?? null,
    fallbackRent: rent,
    occupancyStartDate: tenant?.moveInDate,
    occupancyEndDate: tenant?.moveOutDate ?? endDate.toISOString().slice(0, 10),
  });

  const years = useMemo(() => {
    const set = new Set(months.map((month) => Number(month.slice(0, 4))));
    return Array.from(set).sort((a, b) => b - a);
  }, [months]);
  const filteredMonths = months.filter((month) => Number(month.slice(0, 4)) === yearFilter);

  useEffect(() => {
    const tenantId = tenant?.$id ?? "";
    if (!tenantId) {
      setDeductions([]);
      setDeductionsError(null);
      return;
    }

    let cancelled = false;
    const loadDeductions = async () => {
      setDeductionsLoading(true);
      setDeductionsError(null);
      try {
        const result = await listAllDocuments<SecurityDepositDeduction>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.securityDepositDeductions,
          queries: [Query.equal("tenantId", [tenantId]), Query.orderAsc("deductionDate")],
        });
        if (!cancelled) {
          setDeductions(result);
        }
      } catch {
        if (!cancelled) {
          setDeductions([]);
          setDeductionsError(
            "Failed to load deposit deductions. Ensure the deductions ledger collection exists."
          );
        }
      } finally {
        if (!cancelled) {
          setDeductionsLoading(false);
        }
      }
    };

    void loadDeductions();
    return () => {
      cancelled = true;
    };
  }, [tenant?.$id]);

  useEffect(() => {
    if (!statusOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseStatus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCloseStatus, statusOpen]);

  useEffect(() => {
    if (years.length > 0 && !years.includes(yearFilter)) {
      setYearFilter(years[0]);
    }
  }, [yearFilter, years]);

  const depositPaid = Math.max(Number(tenant?.securityDepositPaid) || 0, 0);
  const totalDeductions = deductions.reduce(
    (sum, entry) => sum + (Number(entry.amount) || 0),
    0
  );
  const refundableBalance = depositPaid - totalDeductions;
  const runningDeductionRows = useMemo(() => {
    let runningBalance = depositPaid;
    return deductions.map((entry) => {
      const amount = Number(entry.amount) || 0;
      runningBalance -= amount;
      return {
        entry,
        runningBalance,
      };
    });
  }, [deductions, depositPaid]);

  if (!tenant) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Select a tenant to view details.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Tenant Detail
          </div>
          <h4 className="mt-3 text-xl font-semibold text-white">{tenant.fullName}</h4>
          <p className="mt-1 text-sm text-slate-400">{tenant.phone || "--"}</p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
          {tenant.status}
        </span>
      </div>

      <div className="mt-6 grid gap-4 text-sm text-slate-300 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Assigned House
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {resolveHouseLabel(tenant, houses)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Rent Rate
          </div>
          <div className="amount mt-2 text-lg font-semibold text-slate-100">
            {formatAmount(rent)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Move-in Date
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {formatDisplayDate(tenant.moveInDate)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Move-out Date (Optional)
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {formatDisplayDate(tenant.moveOutDate)}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={onOpenStatus}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200"
        >
          View Payment Status
        </button>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-slate-100">Deposit Deductions</h5>
            <p className="mt-1 text-xs text-slate-500">
              History of maintenance deductions tied to this tenant.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-xs text-slate-500">Deposit Paid</div>
            <div className="amount mt-1 font-semibold text-slate-100">{formatAmount(depositPaid)}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-xs text-slate-500">Total Deductions</div>
            <div className="amount mt-1 font-semibold text-slate-100">
              {formatAmount(totalDeductions)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-xs text-slate-500">Current Refundable Balance</div>
            <div
              className={[
                "amount mt-1 font-semibold",
                refundableBalance < 0 ? "text-rose-300" : "text-slate-100",
              ].join(" ")}
            >
              {formatAmount(refundableBalance)}
            </div>
          </div>
        </div>

        {deductionsError && (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {deductionsError}
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Item Fixed</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Expense Ref</th>
                <th className="px-3 py-2">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {runningDeductionRows.map(({ entry, runningBalance }) => (
                <tr key={entry.$id} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-300">
                    {formatDisplayDate(entry.deductionDate)}
                  </td>
                  <td className="px-3 py-2 text-slate-200">{entry.itemFixed || "--"}</td>
                  <td className="amount px-3 py-2 text-slate-200">{formatAmount(entry.amount)}</td>
                  <td className="px-3 py-2 text-slate-400">{entry.deductionNote || "--"}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.expenseReference || "--"}</td>
                  <td
                    className={[
                      "amount px-3 py-2 font-medium",
                      runningBalance < 0 ? "text-rose-300" : "text-slate-200",
                    ].join(" ")}
                  >
                    {formatAmount(runningBalance)}
                  </td>
                </tr>
              ))}
              {!deductionsLoading && runningDeductionRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-sm text-slate-500">
                    No deposit deductions recorded for this tenant yet.
                  </td>
                </tr>
              )}
              {deductionsLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-sm text-slate-500">
                    Loading deposit deductions...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {statusOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 py-4 sm:items-center sm:px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">
                Payment Status by Month
              </h3>
              <button
                onClick={onCloseStatus}
                className="btn-secondary text-sm"
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span>Year</span>
              <select
                className="input-base rounded-md px-3 py-2 text-sm"
                value={yearFilter}
                onChange={(event) => setYearFilter(Number(event.target.value))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 max-h-[60vh] overflow-auto pr-2">
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-white">
                <table className="tenant-status-table min-w-[680px] w-full text-left text-sm text-slate-300">
                  <thead className="text-xs text-slate-500" style={{ backgroundColor: "#ffffff" }}>
                    <tr>
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">Date Paid</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMonths.map((month) => {
                      const paid = paidByMonth[month] ?? 0;
                      const expected = rentByMonth[month] ?? rent;
                      const remaining = Math.max(expected - paid, 0);
                      const status =
                        paid >= expected && expected > 0
                          ? "Paid"
                          : paid > 0
                            ? "Partial"
                            : "Unpaid";
                      const statusClass =
                        status === "Paid"
                          ? "text-white border-emerald-600 bg-emerald-600"
                          : status === "Partial"
                            ? "text-white border-amber-500 bg-amber-500"
                            : "text-white border-rose-600 bg-rose-600";
                      const entries = paymentSummaryByMonth[month] ?? [];

                      if (entries.length === 0) {
                        return (
                          <tr
                            key={month}
                            className="border-t"
                            style={{ borderColor: "var(--border)", backgroundColor: "#ffffff" }}
                          >
                            <td className="px-4 py-3 text-slate-100">
                              {formatShortMonth(month)}
                            </td>
                            <td className="px-4 py-3 text-slate-500">N/A</td>
                            <td className="amount px-4 py-3">{formatAmount(0)}</td>
                            <td className="amount px-4 py-3 text-slate-200">
                              {formatAmount(remaining)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full border px-3 py-1 text-xs ${statusClass}`}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      return entries.map((entry, index) => (
                        <tr
                          key={`${month}-${entry.paymentDate}-${index}`}
                          className="border-t"
                          style={{ borderColor: "var(--border)", backgroundColor: "#ffffff" }}
                        >
                          <td className="px-4 py-3 text-slate-100">
                            {index === 0 ? formatShortMonth(month) : ""}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {formatDisplayDate(entry.paymentDate, "N/A")}
                          </td>
                          <td className="amount px-4 py-3">
                            {formatAmount(entry.amount)}
                          </td>
                          <td className="amount px-4 py-3 text-slate-200">
                            {index === 0
                              ? formatAmount(remaining)
                              : ""}
                          </td>
                          <td className="px-4 py-3">
                            {index === 0 ? (
                              <span className={`rounded-full border px-3 py-1 text-xs ${statusClass}`}>
                                {status}
                              </span>
                            ) : (
                              ""
                            )}
                          </td>
                        </tr>
                      ));
                    })}
                    {filteredMonths.length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={5}>
                          No payment status records for the selected year.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
