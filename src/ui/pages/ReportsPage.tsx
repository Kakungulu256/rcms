import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import {
  addMonths,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS, decodeJson } from "../../lib/schema";
import type { Expense, House, Payment, PaymentAllocation, Tenant } from "../../lib/schema";
import { useToast } from "../ToastContext";
import {
  buildMonthSeries,
  buildPaidByMonth,
  buildPaymentSummaryByMonth,
} from "../payments/allocation";
import { buildRentByMonth } from "../../lib/rentHistory";

type SummaryRow = {
  metric: string;
  value: string;
};

type ArrearsRow = {
  tenantId: string;
  tenantName: string;
  houseLabel: string;
  statusLabel: string;
  expected: number;
  paid: number;
  balance: number;
};

type ExpenseCategoryRow = {
  category: string;
  total: number;
};

type HouseRangeRow = {
  houseId: string;
  houseCode: string;
  houseName: string;
  collected: number;
  owed: number;
  occupancyStatus: string;
  occupiedPeriods: string;
  vacantPeriods: string;
};

type MonthlyTenantStatusRow = {
  tenantId: string;
  unitNo: string;
  tenantName: string;
  contact: string;
  rate: number;
  nextRate: number;
  rentPaid: number;
  balance: number;
  datePaid: string;
  status: string;
};

type DisbursementRow = {
  label: string;
  amount: number;
};

function currency(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function ush(value: number) {
  return `USh ${currency(value)}`;
}

function dateKey(value: string | Date) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return format(value, "yyyy-MM-dd");
}

function formatRangeLabel(start: Date, end: Date) {
  return `${dateKey(start)} to ${dateKey(end)}`;
}

function mergeIntervals(
  intervals: Array<{ start: Date; end: Date }>
): Array<{ start: Date; end: Date }> {
  if (intervals.length === 0) return [];
  const sorted = intervals
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.start.getTime() <= current.end.getTime()) {
      if (next.end.getTime() > current.end.getTime()) {
        current.end = next.end;
      }
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

function invertIntervals(
  range: { start: Date; end: Date },
  occupied: Array<{ start: Date; end: Date }>
): Array<{ start: Date; end: Date }> {
  if (occupied.length === 0) return [{ start: range.start, end: range.end }];
  const gaps: Array<{ start: Date; end: Date }> = [];
  let cursor = range.start;
  occupied.forEach((slot) => {
    if (slot.start.getTime() > cursor.getTime()) {
      gaps.push({ start: cursor, end: slot.start });
    }
    if (slot.end.getTime() > cursor.getTime()) {
      cursor = slot.end;
    }
  });
  if (cursor.getTime() < range.end.getTime()) {
    gaps.push({ start: cursor, end: range.end });
  }
  return gaps;
}

export default function ReportsPage() {
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState<"month" | "year" | "custom">("month");
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [year, setYear] = useState(() => format(new Date(), "yyyy"));
  const [rangeStart, setRangeStart] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [rangeEnd, setRangeEnd] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [reportType, setReportType] = useState<"summary" | "byHouse" | "tenantDetail">(
    "summary"
  );
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const tenantLookup = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.$id, tenant])),
    [tenants]
  );
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [paymentResult, expenseResult, tenantResult, houseResult] = await Promise.all([
        listAllDocuments<Payment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.payments,
          queries: [
          Query.orderDesc("paymentDate"),
          ],
        }),
        listAllDocuments<Expense>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.expenses,
          queries: [
          Query.orderDesc("expenseDate"),
          ],
        }),
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [
          Query.orderAsc("fullName"),
          ],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [
          Query.orderAsc("code"),
          ],
        }),
      ]);
      setPayments(paymentResult);
      setExpenses(expenseResult);
      setTenants(tenantResult);
      setHouses(houseResult);
    } catch (err) {
      setError("Failed to load report data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const summary = useMemo(() => {
    const rawRange = (() => {
      if (rangeMode === "month") {
        const start = startOfMonth(parseISO(`${month}-01`));
        const end = endOfMonth(start);
        return { start, end };
      }
      if (rangeMode === "year") {
        const start = startOfYear(parseISO(`${year}-01-01`));
        const end = endOfYear(start);
        return { start, end };
      }
      return { start: parseISO(rangeStart), end: parseISO(rangeEnd) };
    })();

    const range =
      rawRange.start <= rawRange.end
        ? rawRange
        : { start: rawRange.end, end: rawRange.start };
    const rangeStartKey = dateKey(range.start);
    const rangeEndKey = dateKey(range.end);
    const rangeStartMonth = format(range.start, "yyyy-MM");
    const rangeEndMonth = format(range.end, "yyyy-MM");

    const paidInRange = payments.reduce((total, payment) => {
      const sign = payment.isReversal ? -1 : 1;
      const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
      if (!allocation) {
        const paymentDateKey = dateKey(payment.paymentDate);
        if (paymentDateKey >= rangeStartKey && paymentDateKey <= rangeEndKey) {
          return total + Number(payment.amount);
        }
        return total;
      }

      const allocationTotal = Object.entries(allocation).reduce((sum, [month, value]) => {
        if (month < rangeStartMonth || month > rangeEndMonth) {
          return sum;
        }
        return sum + Number(value) * sign;
      }, 0);
      return total + allocationTotal;
    }, 0);

    const expensesInRange = expenses.filter((expense) => {
      const key = dateKey(expense.expenseDate);
      return key >= rangeStartKey && key <= rangeEndKey;
    });
    const totalExpenses = expensesInRange.reduce(
      (sum, expense) => sum + expense.amount,
      0
    );
    const netCollection = paidInRange - totalExpenses;

    const rows: SummaryRow[] = [
      {
        metric: "Range",
        value: `${rangeStartKey} to ${rangeEndKey}`,
      },
      { metric: "Rent Collected", value: currency(paidInRange) },
      { metric: "Total Expenses", value: currency(totalExpenses) },
      { metric: "Net Collection", value: currency(netCollection) },
      { metric: "Active Tenants", value: String(tenants.filter((t) => t.status === "active").length) },
    ];

    const expensesByCategory = expensesInRange.reduce<Record<string, number>>(
      (acc, expense) => {
        acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount;
        return acc;
      },
      {}
    );
    const expenseCategoryRows: ExpenseCategoryRow[] = Object.entries(expensesByCategory)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    const byTenant = new Map<string, number>();
    const byHouse = new Map<string, number>();
    payments.forEach((payment) => {
      const sign = payment.isReversal ? -1 : 1;
      const tenantId =
        typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";
      const tenant = tenantLookup.get(tenantId);
      const houseId =
        typeof tenant?.house === "string" ? tenant.house : tenant?.house?.$id ?? "";
      const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);

      if (!allocation) {
        const paymentDateKey = dateKey(payment.paymentDate);
        if (paymentDateKey < rangeStartKey || paymentDateKey > rangeEndKey) {
          return;
        }
        byTenant.set(tenantId, (byTenant.get(tenantId) ?? 0) + Number(payment.amount));
        if (houseId) {
          byHouse.set(houseId, (byHouse.get(houseId) ?? 0) + Number(payment.amount));
        }
        return;
      }

      Object.entries(allocation).forEach(([monthKey, value]) => {
        if (monthKey < rangeStartMonth || monthKey > rangeEndMonth) {
          return;
        }
        const amount = Number(value) * sign;
        byTenant.set(tenantId, (byTenant.get(tenantId) ?? 0) + amount);
        if (houseId) {
          byHouse.set(houseId, (byHouse.get(houseId) ?? 0) + amount);
        }
      });
    });

    const tenantRows = Array.from(byTenant.entries())
      .map(([tenantId, total]) => ({
        tenantId,
        tenantName: tenantLookup.get(tenantId)?.fullName ?? tenantId,
        houseLabel: (() => {
          const tenant = tenantLookup.get(tenantId);
          const houseId =
            typeof tenant?.house === "string" ? tenant.house : tenant?.house?.$id ?? "";
          return houseLookup.get(houseId)?.code ?? "--";
        })(),
        total,
      }))
      .sort((a, b) => b.total - a.total);

    const houseRows = Array.from(byHouse.entries())
      .map(([houseId, total]) => ({
        houseId,
        houseCode: houseLookup.get(houseId)?.code ?? houseId,
        houseName: houseLookup.get(houseId)?.name ?? "",
        total,
      }))
      .sort((a, b) => b.total - a.total);

    const byHouseRangeRows: HouseRangeRow[] = houses
      .map((house) => {
        const houseTenants = tenants.filter((tenant) => {
          const tenantHouseId =
            typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
          return tenantHouseId === house.$id;
        });
        const occupiedIntervalsRaw = houseTenants
          .map((tenant) => {
            const moveIn = parseISO(tenant.moveInDate);
            const moveOut = tenant.moveOutDate ? parseISO(tenant.moveOutDate) : range.end;
            const start = moveIn > range.start ? moveIn : range.start;
            const end = moveOut < range.end ? moveOut : range.end;
            if (start.getTime() > end.getTime()) return null;
            return { start, end };
          })
          .filter((item): item is { start: Date; end: Date } => Boolean(item));
        const occupiedIntervals = mergeIntervals(occupiedIntervalsRaw);
        const vacantIntervals = invertIntervals(range, occupiedIntervals);

        let occupancyStatus = "Vacant";
        if (occupiedIntervals.length > 0) {
          const fullyOccupied = occupiedIntervals.some(
            (interval) =>
              interval.start.getTime() <= range.start.getTime() &&
              interval.end.getTime() >= range.end.getTime()
          );
          occupancyStatus = fullyOccupied ? "Occupied" : "Mixed";
        }

        const occupiedPeriods =
          occupiedIntervals.length > 0
            ? occupiedIntervals
                .map((interval) => formatRangeLabel(interval.start, interval.end))
                .join("; ")
            : "None";
        const vacantPeriods =
          vacantIntervals.length > 0
            ? vacantIntervals
                .map((interval) => formatRangeLabel(interval.start, interval.end))
                .join("; ")
            : "None";

        const houseCollected = houseTenants.reduce((sum, tenant) => {
          const tenantPayments = payments.filter((payment) => {
            const tenantId =
              typeof payment.tenant === "string"
                ? payment.tenant
                : payment.tenant?.$id ?? "";
            return tenantId === tenant.$id;
          });
          const paidByMonth = buildPaidByMonth(tenantPayments);
          const months = buildMonthSeries(tenant.moveInDate, range.end).filter(
            (month) => month >= rangeStartMonth && month <= rangeEndMonth
          );
          return (
            sum +
            months.reduce((monthSum, month) => monthSum + (paidByMonth[month] ?? 0), 0)
          );
        }, 0);

        const houseExpected = houseTenants.reduce((sum, tenant) => {
          const months = buildMonthSeries(tenant.moveInDate, range.end).filter((month) => {
            if (month < rangeStartMonth || month > rangeEndMonth) return false;
            if (!tenant.moveOutDate) return true;
            return month <= tenant.moveOutDate.slice(0, 7);
          });
          const rentByMonth = buildRentByMonth({
            months,
            tenantHistoryJson: tenant.rentHistoryJson ?? null,
            houseHistoryJson: house.rentHistoryJson ?? null,
            fallbackRent: tenant.rentOverride ?? house.monthlyRent ?? 0,
          });
          return sum + months.reduce((monthSum, month) => monthSum + (rentByMonth[month] ?? 0), 0);
        }, 0);

        return {
          houseId: house.$id,
          houseCode: house.code,
          houseName: house.name ?? "",
          collected: houseCollected,
          owed: Math.max(houseExpected - houseCollected, 0),
          occupancyStatus,
          occupiedPeriods,
          vacantPeriods,
        };
      })
      .sort((a, b) => b.collected - a.collected);

    const today = new Date();
    const currentDateKey = dateKey(today);

    const arrearsRows: ArrearsRow[] = tenants
      .map((tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const house = houseLookup.get(houseId);
        const moveOut = tenant.moveOutDate ? parseISO(tenant.moveOutDate) : null;
        const effectiveEnd = moveOut && moveOut < today ? moveOut : today;
        const monthsInRange = buildMonthSeries(tenant.moveInDate, effectiveEnd);
        const rentByMonth = buildRentByMonth({
          months: monthsInRange,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
        });
        const tenantPayments = payments.filter((payment) => {
          const tenantId =
            typeof payment.tenant === "string"
              ? payment.tenant
              : payment.tenant?.$id ?? "";
          return tenantId === tenant.$id;
        });
        const paidByMonth = buildPaidByMonth(tenantPayments);
        const expected = monthsInRange.reduce(
          (sum, month) => sum + (rentByMonth[month] ?? 0),
          0
        );
        const paid = monthsInRange.reduce(
          (sum, month) => sum + (paidByMonth[month] ?? 0),
          0
        );
        const balance = Math.max(expected - paid, 0);
        return {
          tenantId: tenant.$id,
          tenantName: tenant.fullName,
          houseLabel: house?.code ?? "--",
          statusLabel:
            tenant.status === "active" && !tenant.moveOutDate
              ? "active"
              : "inactive (moved out)",
          expected,
          paid,
          balance,
        };
      })
      .filter((row) => row.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    const totalTenantBalance = arrearsRows.reduce((sum, row) => sum + row.balance, 0);
    rows.push({
      metric: "Outstanding Tenant Balances",
      value: currency(totalTenantBalance),
    });

    const reportMonthKey = rangeEndMonth;
    const reportMonthDate = parseISO(`${reportMonthKey}-01`);
    const reportMonthStart = startOfMonth(reportMonthDate);
    const reportMonthEnd = endOfMonth(reportMonthDate);
    const nextMonthDate = addMonths(reportMonthDate, 1);
    const nextMonthKey = format(nextMonthDate, "yyyy-MM");
    const reportMonthLabel = format(reportMonthDate, "MMMM yyyy");
    const nextMonthLabel = format(nextMonthDate, "MMMM yyyy");

    const monthlyTenancyRows: MonthlyTenantStatusRow[] = tenants
      .filter((tenant) => {
        const moveIn = parseISO(tenant.moveInDate);
        const moveOut = tenant.moveOutDate ? parseISO(tenant.moveOutDate) : null;
        if (moveIn > reportMonthEnd) return false;
        if (moveOut && moveOut < reportMonthStart) return false;
        return true;
      })
      .map((tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const house = houseLookup.get(houseId);
        const tenantPayments = payments.filter((payment) => {
          const tenantId =
            typeof payment.tenant === "string"
              ? payment.tenant
              : payment.tenant?.$id ?? "";
          return tenantId === tenant.$id;
        });
        const paidByMonth = buildPaidByMonth(tenantPayments);
        const paymentSummaryByMonth = buildPaymentSummaryByMonth(tenantPayments);
        const monthsToReport = buildMonthSeries(tenant.moveInDate, reportMonthDate);
        const monthsForRates = Array.from(
          new Set([...monthsToReport, reportMonthKey, nextMonthKey])
        );
        const rentByMonth = buildRentByMonth({
          months: monthsForRates,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
        });
        const expectedUpToReport = monthsToReport.reduce(
          (sum, month) => sum + (rentByMonth[month] ?? 0),
          0
        );
        const paidUpToReport = monthsToReport.reduce(
          (sum, month) => sum + (paidByMonth[month] ?? 0),
          0
        );
        const rate = rentByMonth[reportMonthKey] ?? 0;
        const nextRate = rentByMonth[nextMonthKey] ?? rate;
        const rentPaid = paidByMonth[reportMonthKey] ?? 0;
        const balance = Math.max(expectedUpToReport - paidUpToReport, 0);
        const paymentDatesThisMonth = (paymentSummaryByMonth[reportMonthKey] ?? [])
          .filter((item) => item.amount > 0)
          .map((item) => item.paymentDate)
          .sort((a, b) => a.localeCompare(b));
        const latestPaymentDate =
          paymentDatesThisMonth.length > 0
            ? paymentDatesThisMonth[paymentDatesThisMonth.length - 1]
            : "N/A";
        const status =
          balance > 0 && rentPaid <= 0
            ? "Arrears"
            : rentPaid >= rate && balance > 0
              ? "Paid / Arrears"
              : rentPaid >= rate
                ? "Paid"
                : rentPaid > 0
                  ? "Partial"
                  : "Unpaid";

        return {
          tenantId: tenant.$id,
          unitNo: house?.code ?? "--",
          tenantName: tenant.fullName,
          contact: tenant.phone?.trim() || "N/A",
          rate,
          nextRate,
          rentPaid,
          balance,
          datePaid: latestPaymentDate,
          status,
        };
      })
      .sort((a, b) => {
        const unitSort = a.unitNo.localeCompare(b.unitNo);
        if (unitSort !== 0) return unitSort;
        return a.tenantName.localeCompare(b.tenantName);
      });

    const rentExpectedThisMonth = monthlyTenancyRows.reduce(
      (sum, row) => sum + row.rate,
      0
    );
    const amountPaidThisMonth = monthlyTenancyRows.reduce(
      (sum, row) => sum + Math.max(row.rentPaid, 0),
      0
    );
    const unpaidRentThisMonth = Math.max(rentExpectedThisMonth - amountPaidThisMonth, 0);
    const rentExpectedNextMonth = monthlyTenancyRows.reduce(
      (sum, row) => sum + row.nextRate,
      0
    );
    const tenantsWithArrearsCount = monthlyTenancyRows.filter(
      (row) => row.balance > 0
    ).length;

    const expensesForReportMonth = expenses.filter(
      (expense) => expense.expenseDate?.slice(0, 7) === reportMonthKey
    );
    const disbursementMap = new Map<string, number>();
    expensesForReportMonth.forEach((expense) => {
      const label = expense.description?.trim()
        ? expense.description.trim()
        : expense.category === "maintenance"
          ? "Maintenance"
          : "General Expense";
      disbursementMap.set(label, (disbursementMap.get(label) ?? 0) + expense.amount);
    });
    const disbursementRows: DisbursementRow[] = Array.from(disbursementMap.entries()).map(
      ([label, amount]) => ({ label, amount })
    );
    const totalDisbursements = disbursementRows.reduce(
      (sum, row) => sum + row.amount,
      0
    );
    const totalCashToLandlord = amountPaidThisMonth - totalDisbursements;
    const totalExpectedNextMonth = rentExpectedNextMonth + totalTenantBalance;

    const selectedTenant = selectedTenantId
      ? tenantLookup.get(selectedTenantId) ?? null
      : null;
    const selectedHouse = selectedTenant
      ? houseLookup.get(
          typeof selectedTenant.house === "string"
            ? selectedTenant.house
            : selectedTenant.house?.$id ?? ""
        ) ?? null
      : null;
    const tenantPayments = selectedTenant
      ? payments.filter((payment) => {
          const tenantId =
            typeof payment.tenant === "string"
              ? payment.tenant
              : payment.tenant?.$id ?? "";
          return tenantId === selectedTenant.$id;
        })
      : [];
    const paidByMonth = buildPaidByMonth(tenantPayments);
    const paymentSummaryByMonth = buildPaymentSummaryByMonth(tenantPayments);
    const selectedTenantMoveOut = selectedTenant?.moveOutDate
      ? parseISO(selectedTenant.moveOutDate)
      : null;
    const selectedTenantEnd =
      selectedTenantMoveOut && selectedTenantMoveOut < today
        ? selectedTenantMoveOut
        : today;
    const allMonths = selectedTenant
      ? buildMonthSeries(selectedTenant.moveInDate, selectedTenantEnd)
      : [];
    const monthsInRange = allMonths;
    const rentByMonth = selectedTenant
      ? buildRentByMonth({
          months: monthsInRange,
          tenantHistoryJson: selectedTenant.rentHistoryJson ?? null,
          houseHistoryJson: selectedHouse?.rentHistoryJson ?? null,
          fallbackRent:
            selectedTenant.rentOverride ?? selectedHouse?.monthlyRent ?? 0,
        })
      : {};
    const tenantDetailRows = monthsInRange.map((month) => {
      const expected = rentByMonth[month] ?? 0;
      const paid = paidByMonth[month] ?? 0;
      const balance = Math.max(expected - paid, 0);
      return {
        month,
        expected,
        paid,
        balance,
        payments: paymentSummaryByMonth[month] ?? [],
      };
    });
    const tenantDetailTotals = tenantDetailRows.reduce(
      (acc, row) => {
        acc.expected += row.expected;
        acc.paid += row.paid;
        acc.balance += row.balance;
        return acc;
      },
      { expected: 0, paid: 0, balance: 0 }
    );
    const tenantDetailRangeStartKey = selectedTenant
      ? selectedTenant.moveInDate?.slice(0, 10) ?? ""
      : "";
    const tenantDetailRangeEndKey = selectedTenant ? dateKey(selectedTenantEnd) : "";
    const tenantDetailCurrentDateKey = dateKey(today);
    const tenantDetailStatusLabel = selectedTenant
      ? selectedTenant.status === "active" && !selectedTenant.moveOutDate
        ? "active"
        : "inactive (moved out)"
      : "";

    return {
      rows,
      paidInRange,
      expensesInRange,
      range,
      rangeStartKey,
      rangeEndKey,
      rangeStartMonth,
      rangeEndMonth,
      tenantRows,
      houseRows,
      byHouseRangeRows,
      tenantDetailRows,
      tenantDetailTotals,
      tenantDetailRangeStartKey,
      tenantDetailRangeEndKey,
      tenantDetailCurrentDateKey,
      tenantDetailStatusLabel,
      selectedTenant,
      selectedHouse,
      arrearsRows,
      expenseCategoryRows,
      totalTenantBalance,
      currentDateKey,
      reportMonthKey,
      reportMonthLabel,
      nextMonthLabel,
      monthlyTenancyRows,
      disbursementRows,
      expensesForReportMonth,
      rentExpectedThisMonth,
      amountPaidThisMonth,
      unpaidRentThisMonth,
      rentExpectedNextMonth,
      totalExpectedNextMonth,
      totalDisbursements,
      totalCashToLandlord,
      tenantsWithArrearsCount,
    };
  }, [
    expenses,
    month,
    payments,
    rangeEnd,
    rangeMode,
    rangeStart,
    tenants,
    year,
    tenantLookup,
    houseLookup,
    selectedTenantId,
  ]);

  const exportXlsx = () => {
    setExportingXlsx(true);
    try {
      if (reportType === "tenantDetail" && !summary.selectedTenant) {
        toast.push("warning", "Select a tenant first.");
        return;
      }

      const workbook = XLSX.utils.book_new();

      if (reportType === "tenantDetail" && summary.selectedTenant) {
        const tenantHeaderRows = [
          {
            Tenant: summary.selectedTenant.fullName,
            House: summary.selectedHouse?.code ?? "--",
            MoveInDate: summary.selectedTenant.moveInDate?.slice(0, 10) ?? "",
            CurrentDate: summary.tenantDetailCurrentDateKey,
            Status: summary.tenantDetailStatusLabel,
          },
        ];
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(tenantHeaderRows),
          "Tenant"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            [
              ...summary.tenantDetailRows.map((row) => ({
                Month: row.month,
                PaidForMonth: row.paid,
                ArrearsForMonth: row.balance,
                PaymentDates: row.payments
                  .map((payment) => `${payment.paymentDate} (${currency(payment.amount)})`)
                  .join("; "),
              })),
              {
                Month: "Totals",
                PaidForMonth: summary.tenantDetailTotals.paid,
                ArrearsForMonth: summary.tenantDetailTotals.balance,
                PaymentDates: "",
              },
            ]
          ),
          "TenantDetail"
        );

        const tenantPaymentRows = payments
          .filter((payment) => {
            const tenantId =
              typeof payment.tenant === "string"
                ? payment.tenant
                : payment.tenant?.$id ?? "";
            if (tenantId !== summary.selectedTenant?.$id) {
              return false;
            }
            const key = dateKey(payment.paymentDate);
            return (
              key >= summary.tenantDetailRangeStartKey &&
              key <= summary.tenantDetailRangeEndKey
            );
          })
          .map((payment) => ({
            PaymentDate: payment.paymentDate?.slice(0, 10) ?? "",
            Amount: payment.amount,
            Method: payment.method,
            Reference: payment.reference ?? "",
            IsReversal: payment.isReversal ? "yes" : "no",
          }));
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(tenantPaymentRows),
          "Payments"
        );
      } else if (reportType === "byHouse") {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.byHouseRangeRows.map((row) => ({
              House: row.houseCode,
              Name: row.houseName,
              Collected: row.collected,
              Owed: row.owed,
              Occupancy: row.occupancyStatus,
              OccupiedDates: row.occupiedPeriods,
              VacantDates: row.vacantPeriods,
            }))
          ),
          "ByHouse"
        );
      } else {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(summary.rows),
          "Summary"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.monthlyTenancyRows.map((row) => ({
              UnitNo: row.unitNo,
              TenantName: row.tenantName,
              Contact: row.contact,
              Rate: row.rate,
              RentPaid: row.rentPaid,
              Balance: row.balance,
              DatePaid: row.datePaid,
              Status: row.status,
            }))
          ),
          "MonthlyTenancy"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet([
            { Item: "Total Rent Collected", Amount: summary.amountPaidThisMonth },
            ...summary.disbursementRows.map((row) => ({
              Item: row.label,
              Amount: row.amount,
            })),
            { Item: "Total Cash To Landlord", Amount: summary.totalCashToLandlord },
          ]),
          "Disbursements"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet([
            { Note: `Report Month`, Value: summary.reportMonthLabel },
            { Note: "Rent expected this Month", Value: summary.rentExpectedThisMonth },
            { Note: "Amount of rent paid", Value: summary.amountPaidThisMonth },
            { Note: "Unpaid rent", Value: summary.unpaidRentThisMonth },
            { Note: "Total expected next month", Value: summary.totalExpectedNextMonth },
            {
              Note: "Tenants with arrears",
              Value: summary.tenantsWithArrearsCount,
            },
          ]),
          "Notes"
        );

        const paymentRows = payments
          .filter((payment) => {
            const key = dateKey(payment.paymentDate);
            return key >= summary.rangeStartKey && key <= summary.rangeEndKey;
          })
          .map((payment) => ({
            TenantId:
              typeof payment.tenant === "string"
                ? payment.tenant
                : payment.tenant?.$id ?? "",
            Amount: payment.amount,
            Method: payment.method,
            PaymentDate: payment.paymentDate,
            Reference: payment.reference ?? "",
            IsReversal: payment.isReversal ? "yes" : "no",
          }));
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(paymentRows),
          "Payments"
        );

        const expenseRows = summary.expensesInRange.map((expense) => ({
          Category: expense.category,
          Description: expense.description,
          Amount: expense.amount,
          Source: expense.source,
          ExpenseDate: expense.expenseDate,
          House:
            typeof expense.house === "string"
              ? expense.house
              : expense.house?.$id ?? "",
        }));
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(expenseRows),
          "Expenses"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.arrearsRows.map((row) => ({
              Tenant: row.tenantName,
              House: row.houseLabel,
              Status: row.statusLabel,
              Expected: row.expected,
              Paid: row.paid,
              Balance: row.balance,
            }))
          ),
          "Arrears"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.expenseCategoryRows.map((row) => ({
              Category: row.category,
              Total: row.total,
            }))
          ),
          "ExpensesByCategory"
        );
      }

      const fileSuffix =
        reportType === "tenantDetail" && summary.selectedTenant
          ? `_${summary.selectedTenant.fullName.replace(/\s+/g, "_")}`
          : "";
      const startFileKey =
        reportType === "tenantDetail"
          ? summary.tenantDetailRangeStartKey
          : format(summary.range.start, "yyyyMMdd");
      const endFileKey =
        reportType === "tenantDetail"
          ? summary.tenantDetailRangeEndKey
          : format(summary.range.end, "yyyyMMdd");
      XLSX.writeFile(
        workbook,
        `RCMS_Report${fileSuffix}_${startFileKey.replace(/-/g, "")}_${endFileKey.replace(
          /-/g,
          ""
        )}.xlsx`
      );
      toast.push("success", "Report exported as XLSX.");
    } catch (err) {
      toast.push("error", "Failed to export XLSX report.");
    } finally {
      setExportingXlsx(false);
    }
  };

  const exportPdf = () => {
    setExportingPdf(true);
    try {
      if (reportType === "tenantDetail" && !summary.selectedTenant) {
        toast.push("warning", "Select a tenant first.");
        return;
      }

      const doc = new jsPDF({
        orientation: reportType === "summary" ? "landscape" : "portrait",
      });
      doc.setFontSize(16);
      const title =
        reportType === "summary"
          ? `MONTHLY TENANCY REPORT FOR ${summary.reportMonthLabel.toUpperCase()}`
          : reportType === "byHouse"
          ? "RCMS Collections by House"
          : "RCMS Tenant Collection";
      doc.text(title, 14, 18);
      doc.setFontSize(11);
      let y = 28;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const left = 14;
      const right = pageWidth - 14;
      const bottom = pageHeight - 20;

      const ensureSpace = (height: number) => {
        if (y + height > bottom) {
          doc.addPage();
          y = 20;
        }
      };

      const drawTable = (headers: string[], rows: string[][]) => {
        const tableWidth = right - left;
        const colWidth = tableWidth / headers.length;
        const rowHeight = 7;
        ensureSpace(rowHeight * (rows.length + 2));

        doc.setDrawColor(229, 231, 235);
        doc.setFillColor(249, 250, 251);
        doc.rect(left, y, tableWidth, rowHeight, "F");
        headers.forEach((header, index) => {
          doc.text(header, left + colWidth * index + 2, y + 5);
        });
        y += rowHeight;

        rows.forEach((row) => {
          doc.rect(left, y, tableWidth, rowHeight);
          row.forEach((cell, index) => {
            doc.text(cell, left + colWidth * index + 2, y + 5);
          });
          y += rowHeight;
        });

        y += 6;
      };

      if (reportType === "summary") {
        drawTable(
          ["Metric", "Value"],
          summary.rows.map((row) => [row.metric, row.value])
        );
      }
      if (reportType === "byHouse") {
        drawTable(
          ["House", "Collected", "Owed", "Occupancy"],
          summary.byHouseRangeRows.map((row) => [
            row.houseCode,
            currency(row.collected),
            currency(row.owed),
            row.occupancyStatus,
          ])
        );
      }
      if (reportType === "summary") {
        doc.setFontSize(10);
        doc.text(`Date: ${summary.currentDateKey}`, left, y);
        y += 6;
        doc.text("Summary of Tenants' Payment Status", left, y);
        y += 4;
        doc.setFontSize(11);

        drawTable(
          ["Unit No.", "Tenant Name", "Contact", "Rate", "Rent Paid", "Balance", "Date Paid", "Status"],
          summary.monthlyTenancyRows.map((row) => [
            row.unitNo,
            row.tenantName,
            row.contact,
            row.rate > 0 ? ush(row.rate) : "NIL",
            row.rentPaid > 0 ? ush(row.rentPaid) : "NIL",
            row.balance > 0 ? ush(row.balance) : "NIL",
            row.datePaid,
            row.status,
          ])
        );

        drawTable(
          ["Summary of Disbursements", "Amount"],
          [
            ["Total Rent Collected", ush(summary.amountPaidThisMonth)],
            ...summary.disbursementRows.map((row) => [row.label, ush(row.amount)]),
            ["Total cash to transfer to Landlord", ush(summary.totalCashToLandlord)],
          ]
        );

        ensureSpace(34);
        doc.setFontSize(11);
        doc.text("Notes:", left, y);
        y += 6;
        doc.setFontSize(10);
        doc.text(`1. This is a summary of payments as of ${summary.currentDateKey}.`, left + 4, y);
        y += 5;
        doc.text("2. Breakdown of totals:", left + 4, y);
        y += 5;
        doc.text(`a) Rent expected this month: ${ush(summary.rentExpectedThisMonth)}`, left + 8, y);
        y += 5;
        doc.text(`b) Amount of rent paid: ${ush(summary.amountPaidThisMonth)}`, left + 8, y);
        y += 5;
        doc.text(`c) Unpaid rent: ${ush(summary.unpaidRentThisMonth)}`, left + 8, y);
        y += 5;
        doc.text(`d) Total expected next month: ${ush(summary.totalExpectedNextMonth)}`, left + 8, y);
        y += 5;
        doc.text(
          `3. ${summary.tenantsWithArrearsCount} tenant(s) remained with arrears to be collected in the next month.`,
          left + 4,
          y
        );

        const fileSuffix = `_${summary.reportMonthKey.replace("-", "")}`;
        const startFileKey = format(summary.range.start, "yyyyMMdd");
        const endFileKey = format(summary.range.end, "yyyyMMdd");
        doc.save(
          `RCMS_Monthly_Tenancy_Report${fileSuffix}_${startFileKey}_${endFileKey}.pdf`
        );
        toast.push("success", "Report exported as PDF.");
        return;
      }

      if (reportType === "tenantDetail" && summary.selectedTenant) {
        drawTable(
          ["Tenant", "Move-in", "Current Date", "Status"],
          [[
            summary.selectedTenant.fullName,
            summary.selectedTenant.moveInDate?.slice(0, 10) ?? "--",
            summary.tenantDetailCurrentDateKey || "--",
            summary.tenantDetailStatusLabel || "--",
          ]]
        );
        drawTable(
          ["Month", "Paid", "Arrears"],
          summary.tenantDetailRows.map((row) => [
            row.month,
            currency(row.paid),
            currency(row.balance),
          ])
        );
        drawTable(
          ["Totals", "Paid", "Arrears"],
          [[
            "Totals",
            currency(summary.tenantDetailTotals.paid),
            currency(summary.tenantDetailTotals.balance),
          ]]
        );
      }
      const fileSuffix =
        reportType === "tenantDetail" && summary.selectedTenant
          ? `_${summary.selectedTenant.fullName.replace(/\s+/g, "_")}`
          : "";
      const startFileKey =
        reportType === "tenantDetail"
          ? summary.tenantDetailRangeStartKey
          : format(summary.range.start, "yyyyMMdd");
      const endFileKey =
        reportType === "tenantDetail"
          ? summary.tenantDetailRangeEndKey
          : format(summary.range.end, "yyyyMMdd");
      doc.save(
        `RCMS_Report${fileSuffix}_${startFileKey.replace(/-/g, "")}_${endFileKey.replace(
          /-/g,
          ""
        )}.pdf`
      );
      toast.push("success", "Report exported as PDF.");
    } catch (err) {
      toast.push("error", "Failed to export PDF report.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Reports</div>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Reports &amp; Exports
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Generate monthly summaries and export files.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-4"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <label className="text-sm text-slate-300">
          Report Type
          <select
            className="input-base ml-3 rounded-md px-3 py-2 text-sm"
            value={reportType}
            onChange={(event) => setReportType(event.target.value as typeof reportType)}
          >
            <option value="summary">Summary</option>
            <option value="byHouse">By House</option>
            <option value="tenantDetail">By Tenant</option>
          </select>
        </label>
        {reportType === "tenantDetail" && (
          <label className="text-sm text-slate-300">
            Tenant
            <select
              className="input-base ml-3 min-w-[220px] rounded-md px-3 py-2 text-sm"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              <option value="" disabled>
                Select tenant
              </option>
              {tenants.map((tenant) => (
                <option key={tenant.$id} value={tenant.$id}>
                  {tenant.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        {reportType !== "tenantDetail" && (
          <>
            <label className="text-sm text-slate-300">
              Range Type
              <select
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={rangeMode}
                onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}
              >
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            {rangeMode === "month" && (
              <label className="text-sm text-slate-300">
                Month
                <input
                  type="month"
                  className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </label>
            )}

            {rangeMode === "year" && (
              <label className="text-sm text-slate-300">
                Year
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  className="input-base ml-3 w-28 rounded-md px-3 py-2 text-sm"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
            )}

            {rangeMode === "custom" && (
              <>
                <label className="text-sm text-slate-300">
                  From
                  <input
                    type="date"
                    className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-300">
                  To
                  <input
                    type="date"
                    className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        <button
          onClick={loadData}
          className="btn-secondary text-sm"
        >
          Refresh
        </button>
        <button
          onClick={exportXlsx}
          className="btn-primary text-sm"
          disabled={loading || exportingXlsx}
        >
          {exportingXlsx ? "Exporting..." : "Export XLSX"}
        </button>
        <button
          onClick={exportPdf}
          className="btn-secondary text-sm"
          disabled={loading || exportingPdf}
        >
          {exportingPdf ? "Exporting..." : "Export PDF"}
        </button>
      </div>

      {reportType === "summary" && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {summary.rows.map((row) => (
            <div
              key={row.metric}
              className="rounded-2xl border p-6"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="text-sm text-slate-500">
                {row.metric}
              </div>
              <div className="amount mt-3 text-2xl font-semibold text-slate-100">
                {loading ? "Loading..." : row.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {reportType === "summary" && (
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">
              Monthly Tenancy Report For {summary.reportMonthLabel}
            </div>
            <div className="mt-2 text-center text-xs text-slate-500">
              Date: {summary.currentDateKey}
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[980px] w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Unit No.</th>
                    <th className="px-4 py-3">Tenant Name</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Rate</th>
                    <th className="px-4 py-3">Rent Paid</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3">Date Paid</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.monthlyTenancyRows.map((row) => (
                    <tr
                      key={row.tenantId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-200">{row.unitNo}</td>
                      <td className="px-4 py-3 text-slate-100">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-400">{row.contact}</td>
                      <td className="amount px-4 py-3">{row.rate > 0 ? ush(row.rate) : "NIL"}</td>
                      <td className="amount px-4 py-3">
                        {row.rentPaid > 0 ? ush(row.rentPaid) : "NIL"}
                      </td>
                      <td className="amount px-4 py-3 text-rose-200">
                        {row.balance > 0 ? ush(row.balance) : "NIL"}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.datePaid}</td>
                      <td className="px-4 py-3 text-slate-300">{row.status}</td>
                    </tr>
                  ))}
                  {summary.monthlyTenancyRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={8}>
                        No tenants found for {summary.reportMonthLabel}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-100">
              Summary Of Disbursements
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Expenses recorded in {summary.reportMonthLabel}
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[480px] w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 text-slate-100">Total Rent Collected</td>
                    <td className="amount px-4 py-3">{ush(summary.amountPaidThisMonth)}</td>
                  </tr>
                  {summary.disbursementRows.map((row) => (
                    <tr
                      key={row.label}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{row.label}</td>
                      <td className="amount px-4 py-3">{ush(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 text-slate-100">Total cash to transfer to Landlord</td>
                    <td className="amount px-4 py-3 text-emerald-300">
                      {ush(summary.totalCashToLandlord)}
                    </td>
                  </tr>
                  {summary.disbursementRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={2}>
                        No disbursement entries found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-2 text-sm text-slate-300">
              <div className="font-semibold text-slate-100">Notes</div>
              <div>1. This is a summary of payments as of {summary.currentDateKey}.</div>
              <div>2. Breakdown of totals:</div>
              <div className="pl-4">a. Rent expected this Month: {ush(summary.rentExpectedThisMonth)}</div>
              <div className="pl-4">b. Amount of rent paid: {ush(summary.amountPaidThisMonth)}</div>
              <div className="pl-4">c. Unpaid rent: {ush(summary.unpaidRentThisMonth)}</div>
              <div className="pl-4">d. Total Expected next month: {ush(summary.totalExpectedNextMonth)}</div>
              <div>
                3. {summary.tenantsWithArrearsCount} tenant(s) remained with arrears. This is to be collected in {summary.nextMonthLabel}.
              </div>
            </div>
          </div>
        </div>
      )}

      {reportType === "byHouse" && (
        <div
          className="rounded-2xl border p-6"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="text-sm font-semibold text-slate-100">
            House Collection & Occupancy (Selected Range)
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {summary.rangeStartKey} to {summary.rangeEndKey}
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
            <table className="min-w-[1100px] w-full text-left text-sm text-slate-300">
              <thead
                className="text-xs text-slate-500"
                style={{ backgroundColor: "var(--surface-strong)" }}
              >
                <tr>
                  <th className="px-4 py-3">House</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Collected</th>
                  <th className="px-4 py-3">Owed</th>
                  <th className="px-4 py-3">Occupancy</th>
                  <th className="px-4 py-3">Occupied Dates</th>
                  <th className="px-4 py-3">Vacant Dates</th>
                </tr>
              </thead>
              <tbody>
                {summary.byHouseRangeRows.map((row) => (
                  <tr
                    key={row.houseId}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-3 text-slate-100">{row.houseCode}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.houseName || "--"}
                    </td>
                    <td className="amount px-4 py-3">{currency(row.collected)}</td>
                    <td className="amount px-4 py-3 text-rose-200">{currency(row.owed)}</td>
                    <td className="px-4 py-3 text-slate-300">{row.occupancyStatus}</td>
                    <td className="px-4 py-3 text-slate-400">{row.occupiedPeriods}</td>
                    <td className="px-4 py-3 text-slate-400">{row.vacantPeriods}</td>
                  </tr>
                ))}
                {summary.byHouseRangeRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={8}>
                      No house collections in range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportType === "tenantDetail" && (
        <div
          className="rounded-2xl border p-6"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="text-sm font-semibold text-slate-100">Tenant Collection</div>
          {!summary.selectedTenant ? (
            <div className="mt-4 text-sm text-slate-500">
              Select a tenant to view details.
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 text-sm text-slate-300 md:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Tenant
                  </div>
                  <div className="mt-2 text-slate-100">{summary.selectedTenant.fullName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Move-in: {summary.selectedTenant.moveInDate?.slice(0, 10) ?? "--"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    House
                  </div>
                  <div className="mt-2 text-slate-100">
                    {summary.selectedHouse?.code ?? "--"}{" "}
                    {summary.selectedHouse?.name ? `- ${summary.selectedHouse.name}` : ""}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Account
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Current Date: {summary.tenantDetailCurrentDateKey}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status: {summary.tenantDetailStatusLabel}
                  </div>
                  <div className="amount mt-2 text-slate-100">
                    {currency(summary.tenantDetailTotals.paid)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Paid
                  </div>
                  <div className="amount mt-2 text-rose-200">
                    {currency(summary.tenantDetailTotals.balance)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Arrears</div>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-[760px] w-full text-left text-sm text-slate-300">
                  <thead
                    className="text-xs text-slate-500"
                    style={{ backgroundColor: "var(--surface-strong)" }}
                  >
                    <tr>
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Arrears</th>
                      <th className="px-4 py-3">How Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.tenantDetailRows.map((row) => (
                      <tr key={row.month} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-4 py-3 text-slate-100">{row.month}</td>
                        <td className="amount px-4 py-3">
                          {currency(row.paid)}
                        </td>
                        <td className="amount px-4 py-3 text-rose-200">
                          {currency(row.balance)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {row.payments.length > 0 ? (
                            <div className="space-y-1">
                              {row.payments.map((payment) => (
                                <div key={`${row.month}-${payment.paymentDate}-${payment.amount}`}>
                                  {payment.paymentDate} {currency(payment.amount)}
                                </div>
                              ))}
                            </div>
                          ) : (
                            "--"
                          )}
                        </td>
                      </tr>
                    ))}
                    {summary.tenantDetailRows.length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={4}>
                          No months available for this tenant yet.
                        </td>
                      </tr>
                    )}
                    {summary.tenantDetailRows.length > 0 && (
                      <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-4 py-3 font-semibold text-slate-100">Totals</td>
                        <td className="amount px-4 py-3 font-semibold text-slate-100">
                          {currency(summary.tenantDetailTotals.paid)}
                        </td>
                        <td className="amount px-4 py-3 font-semibold text-rose-200">
                          {currency(summary.tenantDetailTotals.balance)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">--</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {reportType !== "tenantDetail" && (
        <div
          className="rounded-2xl border p-6"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="text-sm font-semibold text-slate-100">Recent Payments</div>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            {payments
              .filter((payment) => {
                const key = dateKey(payment.paymentDate);
                return key >= summary.rangeStartKey && key <= summary.rangeEndKey;
              })
              .slice(0, 6)
              .map((payment) => {
                const tenantLabel =
                  typeof payment.tenant === "string"
                    ? tenantLookup.get(payment.tenant)?.fullName ?? payment.tenant
                    : payment.tenant?.fullName ?? "Tenant";
                return (
                  <div
                    key={payment.$id}
                    className="rounded-xl border px-4 py-3"
                    style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{tenantLabel}</span>
                      <span className="amount">{currency(payment.amount)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {format(parseISO(payment.paymentDate), "yyyy-MM-dd")} - {payment.method}
                    </div>
                  </div>
                );
              })}
            {payments.length === 0 && (
              <div className="text-sm text-slate-500">No payments recorded.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
