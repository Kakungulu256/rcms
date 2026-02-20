import { useEffect, useMemo, useState } from "react";
import {
  buildMonthSeries,
  buildPaidByMonth,
  buildPaymentSummaryByMonth,
} from "../payments/allocation";
import type { House, Payment, Tenant } from "../../lib/schema";
import { buildRentByMonth } from "../../lib/rentHistory";

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
  const moveOutDate = tenant?.moveOutDate ?? null;
  const endDate = moveOutDate ? new Date(moveOutDate) : new Date();
  const months = moveInDate ? buildMonthSeries(moveInDate, endDate) : [];
  const [yearFilter, setYearFilter] = useState(() => new Date().getFullYear());

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
  });

  const years = useMemo(() => {
    const set = new Set(months.map((month) => Number(month.slice(0, 4))));
    return Array.from(set).sort((a, b) => b - a);
  }, [months]);
  const filteredMonths = months.filter((month) => Number(month.slice(0, 4)) === yearFilter);

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

  if (!tenant) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Select a tenant to view details.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex items-start justify-between">
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

      <div className="mt-6 grid gap-4 text-sm text-slate-300">
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
            {rent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Move-in Date
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {tenant.moveInDate?.slice(0, 10)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Move-out Date
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {tenant.moveOutDate?.slice(0, 10) || "--"}
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

      {statusOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between">
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
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-300">
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
                <table className="tenant-status-table min-w-[760px] w-full text-left text-sm text-slate-300">
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
                            <td className="px-4 py-3 text-slate-100">{month}</td>
                            <td className="px-4 py-3 text-slate-500">N/A</td>
                            <td className="amount px-4 py-3">0.00</td>
                            <td className="amount px-4 py-3 text-slate-200">
                              {remaining.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                              })}
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
                            {index === 0 ? month : ""}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{entry.paymentDate}</td>
                          <td className="amount px-4 py-3">
                            {entry.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td className="amount px-4 py-3 text-slate-200">
                            {index === 0
                              ? remaining.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                })
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
