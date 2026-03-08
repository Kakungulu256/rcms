import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { addMonths, endOfMonth, endOfYear, format, isValid, parseISO, startOfMonth, startOfYear } from "date-fns";
import { listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import { buildPaidByMonth, getPaymentMonthAmounts } from "../payments/allocation";
import { buildRentByMonth } from "../../lib/rentHistory";
import {
  buildTenantMonthSeries,
  getTenantEffectiveEndDate,
  isTenantInactiveAtDate,
} from "../../lib/tenancyDates";
import { formatDisplayDate, formatShortMonth } from "../../lib/dateDisplay";
import type { Expense, House, Payment, Tenant } from "../../lib/schema";

type SummaryCard = {
  label: string;
  value: string;
  helper: string;
};

type OverviewMode = "month" | "year";

type OverviewPeriod = {
  mode: OverviewMode;
  label: string;
  start: Date;
  end: Date;
  startMonthKey: string;
  endMonthKey: string;
  monthKeys: string[];
};

function currency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function parseMonthSafe(value: string) {
  const parsed = parseISO(`${value}-01`);
  return isValid(parsed) ? parsed : new Date();
}

function parseYearSafe(value: string) {
  const parsed = parseISO(`${value}-01-01`);
  return isValid(parsed) ? parsed : new Date();
}

function buildMonthKeys(start: Date, end: Date) {
  const keys: string[] = [];
  let cursor = startOfMonth(start);
  const endMonth = startOfMonth(end);
  while (cursor <= endMonth) {
    keys.push(format(cursor, "yyyy-MM"));
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

function buildOverviewPeriod(mode: OverviewMode, month: string, year: string): OverviewPeriod {
  if (mode === "year") {
    const yearDate = parseYearSafe(year);
    const start = startOfYear(yearDate);
    const end = endOfYear(yearDate);
    return {
      mode,
      label: format(start, "yyyy"),
      start,
      end,
      startMonthKey: format(start, "yyyy-MM"),
      endMonthKey: format(end, "yyyy-MM"),
      monthKeys: buildMonthKeys(start, end),
    };
  }

  const monthDate = parseMonthSafe(month);
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  return {
    mode,
    label: formatShortMonth(start),
    start,
    end,
    startMonthKey: format(start, "yyyy-MM"),
    endMonthKey: format(end, "yyyy-MM"),
    monthKeys: [format(start, "yyyy-MM")],
  };
}

export default function DashboardPage() {
  const [houses, setHouses] = useState<House[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [overviewMode, setOverviewMode] = useState<OverviewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedYear, setSelectedYear] = useState(() => format(new Date(), "yyyy"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [houseResult, tenantResult, paymentResult, expenseResult] =
        await Promise.all([
          listAllDocuments<House>({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.houses,
            queries: [Query.orderAsc("code")],
          }),
          listAllDocuments<Tenant>({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.tenants,
            queries: [Query.orderAsc("fullName")],
          }),
          listAllDocuments<Payment>({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.payments,
            queries: [Query.orderDesc("paymentDate")],
          }),
          listAllDocuments<Expense>({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.expenses,
            queries: [Query.orderDesc("expenseDate")],
          }),
        ]);
      setHouses(houseResult);
      setTenants(tenantResult);
      setPayments(paymentResult);
      setExpenses(expenseResult);
    } catch (err) {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();
    years.add(currentYear);

    for (const tenant of tenants) {
      const moveIn = parseISO(tenant.moveInDate);
      if (isValid(moveIn)) {
        years.add(moveIn.getFullYear());
      }
      if (tenant.moveOutDate) {
        const moveOut = parseISO(tenant.moveOutDate);
        if (isValid(moveOut)) {
          years.add(moveOut.getFullYear());
        }
      }
    }

    for (const payment of payments) {
      const paymentDate = parseISO(payment.paymentDate);
      if (isValid(paymentDate)) {
        years.add(paymentDate.getFullYear());
      }
    }

    for (const expense of expenses) {
      const expenseDate = parseISO(expense.expenseDate);
      if (isValid(expenseDate)) {
        years.add(expenseDate.getFullYear());
      }
    }

    for (let year = currentYear - 5; year <= currentYear + 1; year += 1) {
      years.add(year);
    }

    return Array.from(years).sort((a, b) => b - a).map((year) => String(year));
  }, [expenses, payments, tenants]);

  const summary = useMemo(() => {
    const period = buildOverviewPeriod(overviewMode, selectedMonth, selectedYear);
    const today = new Date();
    const effectiveEnd = period.end < today ? period.end : today;
    const effectiveEndMonthKey = format(effectiveEnd, "yyyy-MM");
    const periodMonthKeys = period.monthKeys.filter(
      (monthKey) => monthKey <= effectiveEndMonthKey
    );
    const monthKeySet = new Set(periodMonthKeys);
    const normalizedPayments = (() => {
      const seenReversalTargets = new Set<string>();
      return payments.filter((payment) => {
        if (!payment.isReversal || !payment.reversedPaymentId) return true;
        if (seenReversalTargets.has(payment.reversedPaymentId)) return false;
        seenReversalTargets.add(payment.reversedPaymentId);
        return true;
      });
    })();
    const houseLookup = new Map(houses.map((house) => [house.$id, house]));
    const occupiedHouseIds = new Set(
      tenants
        .filter((tenant) => {
          const moveIn = parseISO(tenant.moveInDate);
          if (!isValid(moveIn) || moveIn > effectiveEnd) {
            return false;
          }
          const tenantEnd = getTenantEffectiveEndDate(tenant, effectiveEnd);
          return tenantEnd >= effectiveEnd;
        })
        .map((tenant) => (typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? ""))
        .filter(Boolean)
    );
    const inactiveHouses = houses.filter((house) => house.status === "inactive").length;
    const occupied = houses.filter((house) => occupiedHouseIds.has(house.$id)).length;
    const vacant = houses.filter(
      (house) => house.status !== "inactive" && !occupiedHouseIds.has(house.$id)
    ).length;

    const expectedRent = tenants.reduce((total, tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const house = houseLookup.get(houseId);
      const months = buildTenantMonthSeries(tenant, effectiveEnd).filter(
        (month) => month >= period.startMonthKey && month <= effectiveEndMonthKey
      );
      if (months.length === 0) {
        return total;
      }
      const rentByMonth = buildRentByMonth({
        months,
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
        occupancyStartDate: tenant.moveInDate,
        occupancyEndDate: getTenantEffectiveEndDate(tenant, effectiveEnd)
          .toISOString()
          .slice(0, 10),
      });
      return total + months.reduce((sum, month) => sum + (rentByMonth[month] ?? 0), 0);
    }, 0);

    const paidForPeriod = normalizedPayments.reduce(
      (sum, payment) =>
        sum +
        getPaymentMonthAmounts(payment).reduce((monthSum, entry) => {
          if (!monthKeySet.has(entry.month)) return monthSum;
          return monthSum + entry.amount;
        }, 0),
      0
    );

    const tenantBalanceRows = tenants.map((tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const house = houseLookup.get(houseId);
      const tenantPayments = payments.filter((payment) => {
        const tenantId =
          typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";
        return tenantId === tenant.$id;
      });
      const months = buildTenantMonthSeries(tenant, effectiveEnd).filter(
        (month) => month <= effectiveEndMonthKey
      );
      if (months.length === 0) {
        return {
          tenantId: tenant.$id,
          inactive: isTenantInactiveAtDate(tenant, effectiveEnd),
          balance: 0,
        };
      }
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const rentByMonth = buildRentByMonth({
        months,
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
        occupancyStartDate: tenant.moveInDate,
        occupancyEndDate: getTenantEffectiveEndDate(tenant, effectiveEnd)
          .toISOString()
          .slice(0, 10),
      });
      const expected = months.reduce((acc, month) => acc + (rentByMonth[month] ?? 0), 0);
      const paid = months.reduce((acc, month) => acc + (paidByMonth[month] ?? 0), 0);
      return {
        tenantId: tenant.$id,
        inactive: isTenantInactiveAtDate(tenant, effectiveEnd),
        balance: Math.max(expected - paid, 0),
      };
    });

    const arrears = tenantBalanceRows
      .filter((row) => !row.inactive)
      .reduce((sum, row) => sum + row.balance, 0);
    const inactiveTenantArrears = tenantBalanceRows
      .filter((row) => row.inactive)
      .reduce((sum, row) => sum + row.balance, 0);
    const inactiveTenantArrearsCount = tenantBalanceRows.filter(
      (row) => row.inactive && row.balance > 0
    ).length;

    const expensesInPeriod = expenses.filter((expense) => {
      const expenseMonth = expense.expenseDate?.slice(0, 7) ?? "";
      return Boolean(expenseMonth) && expenseMonth >= period.startMonthKey && expenseMonth <= effectiveEndMonthKey;
    });
    const totalExpenses = expensesInPeriod.reduce(
      (sum, expense) => sum + expense.amount,
      0
    );
    const periodExpenseCount = expensesInPeriod.length;
    const periodPaymentCount = normalizedPayments.filter((payment) => {
      if (payment.isReversal) return false;
      return getPaymentMonthAmounts(payment).some(
        (entry) => monthKeySet.has(entry.month) && entry.amount > 0
      );
    }).length;
    const expectedLabel =
      period.mode === "month" ? `For ${period.label}` : `For ${period.label} (year)`;
    const periodLabel =
      effectiveEnd < period.end
        ? `${period.label} (to ${formatShortMonth(effectiveEnd)})`
        : period.label;

    const cards: SummaryCard[] = [
      {
        label: "Occupancy",
        value: `${occupied} occupied / ${vacant} vacant`,
        helper: `${houses.length} total houses (${inactiveHouses} inactive) as of ${formatDisplayDate(effectiveEnd)}`,
      },
      {
        label: "Rent Expected",
        value: currency(expectedRent),
        helper: expectedLabel,
      },
      {
        label: "Rent Collected",
        value: currency(paidForPeriod),
        helper: `Rent-only collected for ${periodLabel} (${periodPaymentCount} payment records)`,
      },
      {
        label: "Outstanding Arrears",
        value: currency(arrears),
        helper: `Active tenants only up to ${formatDisplayDate(effectiveEnd)}`,
      },
      {
        label: "Inactive Tenant Arrears",
        value: currency(inactiveTenantArrears),
        helper: `${inactiveTenantArrearsCount} tenant(s) left with unpaid balance`,
      },
      {
        label: "Total Expenses",
        value: currency(totalExpenses),
        helper: `${periodLabel} - ${periodExpenseCount} expense records`,
      },
    ];

    return { cards, periodLabel };
  }, [expenses, houses, overviewMode, payments, selectedMonth, selectedYear, tenants]);

  return (
    <section className="space-y-6">
      <div
        className="rounded-2xl border p-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h3 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          Dashboard Overview
        </h3>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Summary for {summary.periodLabel}.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-sm" style={{ color: "var(--muted)" }}>
            View by
            <select
              className="input-base ml-3 rounded-md px-3 py-2 text-sm"
              value={overviewMode}
              onChange={(event) => setOverviewMode(event.target.value as OverviewMode)}
            >
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          {overviewMode === "month" ? (
            <label className="text-sm" style={{ color: "var(--muted)" }}>
              Month
              <input
                type="month"
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              />
            </label>
          ) : (
            <label className="text-sm" style={{ color: "var(--muted)" }}>
              Year
              <select
                className="input-base ml-3 w-32 rounded-md px-3 py-2 text-sm"
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {summary.cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              {card.label}
            </div>
            <div className="amount mt-2 text-2xl font-semibold" style={{ color: "var(--text)" }}>
              {loading ? "Loading..." : card.value}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {card.helper}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
