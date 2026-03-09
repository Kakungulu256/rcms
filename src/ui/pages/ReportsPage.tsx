import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { Link } from "react-router-dom";
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
import { COLLECTIONS } from "../../lib/schema";
import type {
  AuditLog,
  Expense,
  House,
  Payment,
  SecurityDepositDeduction,
  Tenant,
} from "../../lib/schema";
import { useToast } from "../ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { logAudit } from "../../lib/audit";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";
import {
  buildPaidByMonth,
  buildPaymentSummaryByMonth,
  getPaymentMonthAmounts,
} from "../payments/allocation";
import { buildRentByMonth } from "../../lib/rentHistory";
import {
  buildTenantMonthSeries,
  getTenantEffectiveEndDate,
  isTenantInactiveAtDate,
} from "../../lib/tenancyDates";
import {
  getLatestPaymentNoteForMonth,
  getLatestPaymentNoteForRange,
} from "../../lib/paymentNotes";
import { formatDisplayDate, formatShortMonth } from "../../lib/dateDisplay";
import TypeaheadField, { type TypeaheadOption } from "../TypeaheadField";

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
  moveOutDate: string | null;
  status: string;
  statusNote: string | null;
};

type DisbursementRow = {
  label: string;
  amount: number;
};

type InactiveArrearsRow = {
  tenantId: string;
  tenantName: string;
  houseLabel: string;
  moveInDate: string;
  moveOutDate: string;
  totalPaid: number;
  balanceLeft: number;
};

type DepositDeductionReportRow = {
  deductionId: string;
  tenantId: string;
  tenantName: string;
  houseLabel: string;
  deductionDateKey: string;
  deductionDate: string;
  itemFixed: string;
  amount: number;
  deductionNote: string;
  expenseReference: string;
};

type DepositBalanceRow = {
  tenantId: string;
  tenantName: string;
  houseLabel: string;
  depositPaid: number;
  openingBalance: number;
  deductedInRange: number;
  closingBalance: number;
  deductionsInRangeCount: number;
};

function currency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function ush(value: number) {
  return currency(value);
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function dateKey(value: string | Date) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return format(value, "yyyy-MM-dd");
}

function formatRangeLabel(start: Date, end: Date) {
  return `${formatDisplayDate(start)} to ${formatDisplayDate(end)}`;
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
  const { user, planLimits } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [securityDepositDeductions, setSecurityDepositDeductions] = useState<
    SecurityDepositDeduction[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState<"month" | "year" | "custom">("month");
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [year, setYear] = useState(() => format(new Date(), "yyyy"));
  const [rangeStart, setRangeStart] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [rangeEnd, setRangeEnd] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [reportType, setReportType] = useState<
    "summary" | "byHouse" | "tenantDetail" | "inactiveArrears" | "depositDeductions"
  >("summary");
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [personalReportNote, setPersonalReportNote] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportsThisMonth, setExportsThisMonth] = useState(0);
  const exportLimitStatus = useMemo(
    () => getLimitStatus(planLimits.exportsPerMonth, exportsThisMonth),
    [exportsThisMonth, planLimits.exportsPerMonth]
  );

  const tenantLookup = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.$id, tenant])),
    [tenants]
  );
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const tenantSelectionOptions = useMemo<TypeaheadOption[]>(
    () =>
      tenants.map((tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const house = houseLookup.get(houseId);
        const houseCode = house?.code?.trim() ?? "";
        const houseName = house?.name?.trim() ?? "";
        const houseLabel =
          houseCode && houseName ? `${houseCode} - ${houseName}` : houseCode || houseName;
        const phone = tenant.phone?.trim() ?? "";
        const description = [houseLabel, phone].filter(Boolean).join(" • ");
        return {
          id: tenant.$id,
          label: tenant.fullName,
          description: description || undefined,
          keywords: [phone, houseCode, houseName].filter(Boolean).join(" "),
        };
      }),
    [houseLookup, tenants]
  );
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 50 }, (_, index) => String(currentYear - index));
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
      const [
        paymentResult,
        expenseResult,
        tenantResult,
        houseResult,
        deductionResult,
        exportAuditResult,
      ] =
        await Promise.all([
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
        listAllDocuments<SecurityDepositDeduction>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.securityDepositDeductions,
          queries: [Query.orderAsc("deductionDate")],
        }).catch(() => []),
        listAllDocuments<AuditLog>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.auditLogs,
          queries: [
            Query.equal("entityType", ["report_export"]),
            Query.equal("action", ["create"]),
            Query.greaterThanEqual("timestamp", [currentMonthStart]),
            Query.orderDesc("timestamp"),
          ],
        }).catch(() => []),
        ]);
      setPayments(paymentResult);
      setExpenses(expenseResult);
      setTenants(tenantResult);
      setHouses(houseResult);
      setSecurityDepositDeductions(deductionResult);
      setExportsThisMonth(exportAuditResult.length);
    } catch (err) {
      setError("Failed to load report data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const ensureExportAllowed = () => {
    if (!exportLimitStatus.reached) return true;
    const message =
      "Monthly export limit reached on your current plan. Upgrade in Settings to continue exporting.";
    toast.push("warning", message);
    return false;
  };

  const recordExportAudit = (formatType: "pdf" | "xlsx", reportName: string) => {
    if (!user) return;
    void logAudit({
      entityType: "report_export",
      entityId: `${reportType}_${Date.now()}`,
      action: "create",
      actorId: user.id,
      details: {
        format: formatType,
        reportType,
        reportName,
      },
    })
      .then(() => setExportsThisMonth((prev) => prev + 1))
      .catch(() => undefined);
  };

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
    const rangeStartDisplay = formatDisplayDate(range.start);
    const rangeEndDisplay = formatDisplayDate(range.end);
    const rangeStartMonth = format(range.start, "yyyy-MM");
    const rangeEndMonth = format(range.end, "yyyy-MM");
    const isCustomRange = rangeMode === "custom";
    const isMonthRange = rangeMode === "month";
    const getOccupancyEndDateKey = (tenant: Tenant, referenceDate: Date) => {
      if (tenant.moveOutDate?.trim()) {
        return tenant.moveOutDate.slice(0, 10);
      }
      if (tenant.status === "inactive") {
        return getTenantEffectiveEndDate(tenant, referenceDate)
          .toISOString()
          .slice(0, 10);
      }
      return null;
    };

    const isPaymentDateWithinRange = (payment: Payment) => {
      const paymentDateKey = dateKey(payment.paymentDate);
      return paymentDateKey >= rangeStartKey && paymentDateKey <= rangeEndKey;
    };

    const paymentAllocationForMonthsInRange = (payment: Payment) =>
      getPaymentMonthAmounts(payment).reduce((sum, entry) => {
        if (entry.month < rangeStartMonth || entry.month > rangeEndMonth) {
          return sum;
        }
        return sum + entry.amount;
      }, 0);

    const paymentAllocationTotal = (payment: Payment) =>
      getPaymentMonthAmounts(payment).reduce((sum, entry) => sum + entry.amount, 0);

    const paymentAmountForSelectedRange = (payment: Payment) => {
      if (isCustomRange) {
        if (!isPaymentDateWithinRange(payment)) return 0;
        return paymentAllocationTotal(payment);
      }
      return paymentAllocationForMonthsInRange(payment);
    };

    const paidInRange = payments.reduce((total, payment) => {
      return total + paymentAmountForSelectedRange(payment);
    }, 0);

    const expensesInRange = expenses.filter((expense) => {
      const key = dateKey(expense.expenseDate);
      return key >= rangeStartKey && key <= rangeEndKey;
    });

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
      const tenantId =
        typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";
      const tenant = tenantLookup.get(tenantId);
      const houseId =
        typeof tenant?.house === "string" ? tenant.house : tenant?.house?.$id ?? "";

      const paymentTotalInRange = paymentAmountForSelectedRange(payment);

      if (paymentTotalInRange === 0) {
        return;
      }

      byTenant.set(tenantId, (byTenant.get(tenantId) ?? 0) + paymentTotalInRange);
      if (houseId) {
        byHouse.set(houseId, (byHouse.get(houseId) ?? 0) + paymentTotalInRange);
      }
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
            const effectiveEnd = getTenantEffectiveEndDate(tenant, range.end);
            const start = moveIn > range.start ? moveIn : range.start;
            const end = effectiveEnd < range.end ? effectiveEnd : range.end;
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
          if (isCustomRange) {
            return (
              sum +
              tenantPayments.reduce(
                (tenantSum, payment) =>
                  tenantSum + paymentAmountForSelectedRange(payment),
                0
              )
            );
          }
          const paidByMonth = buildPaidByMonth(tenantPayments);
          const months = buildTenantMonthSeries(tenant, range.end).filter(
            (month) => month >= rangeStartMonth && month <= rangeEndMonth
          );
          return (
            sum +
            months.reduce((monthSum, month) => monthSum + (paidByMonth[month] ?? 0), 0)
          );
        }, 0);

        const houseExpected = houseTenants.reduce((sum, tenant) => {
          const months = buildTenantMonthSeries(tenant, range.end).filter(
            (month) => month >= rangeStartMonth && month <= rangeEndMonth
          );
          const rentByMonth = buildRentByMonth({
            months,
            tenantHistoryJson: tenant.rentHistoryJson ?? null,
            houseHistoryJson: house.rentHistoryJson ?? null,
            fallbackRent: tenant.rentOverride ?? house.monthlyRent ?? 0,
            occupancyStartDate: tenant.moveInDate,
            occupancyEndDate: getOccupancyEndDateKey(tenant, range.end),
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
    const currentDateKey = formatDisplayDate(today);

    const arrearsRows: ArrearsRow[] = tenants
      .map((tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const house = houseLookup.get(houseId);
        const monthsInRange = buildTenantMonthSeries(tenant, today);
        const rentByMonth = buildRentByMonth({
          months: monthsInRange,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
          occupancyStartDate: tenant.moveInDate,
          occupancyEndDate: getOccupancyEndDateKey(tenant, today),
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
          statusLabel: isTenantInactiveAtDate(tenant, today) ? "inactive" : "active",
          expected,
          paid,
          balance,
        };
      })
      .filter((row) => row.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    const totalTenantBalance = arrearsRows
      .filter((row) => row.statusLabel === "active")
      .reduce((sum, row) => sum + row.balance, 0);
    const inactiveArrearsRows: InactiveArrearsRow[] = tenants
      .map((tenant) => {
        const inactiveDate = getTenantEffectiveEndDate(tenant, range.end);
        if (!isTenantInactiveAtDate(tenant, range.end)) {
          return null;
        }
        const inactiveDateKey = dateKey(inactiveDate);
        if (inactiveDateKey < rangeStartKey || inactiveDateKey > rangeEndKey) {
          return null;
        }

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
        const monthsAtExit = buildTenantMonthSeries(tenant, inactiveDate);
        const paidByMonth = buildPaidByMonth(tenantPayments);
        const rentByMonth = buildRentByMonth({
          months: monthsAtExit,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
          occupancyStartDate: tenant.moveInDate,
          occupancyEndDate: inactiveDate.toISOString().slice(0, 10),
        });
        const expectedAtExit = monthsAtExit.reduce(
          (sum, month) => sum + (rentByMonth[month] ?? 0),
          0
        );
        const paidAtExit = monthsAtExit.reduce(
          (sum, month) => sum + (paidByMonth[month] ?? 0),
          0
        );
        const balanceLeft = Math.max(expectedAtExit - paidAtExit, 0);
        if (balanceLeft <= 0) {
          return null;
        }

        return {
          tenantId: tenant.$id,
          tenantName: tenant.fullName,
          houseLabel: house?.code ?? "--",
          moveInDate: formatDisplayDate(tenant.moveInDate),
          moveOutDate: formatDisplayDate(tenant.moveOutDate ?? inactiveDate.toISOString()),
          totalPaid: paidAtExit,
          balanceLeft,
        };
      })
      .filter((row): row is InactiveArrearsRow => Boolean(row))
      .sort((a, b) => b.balanceLeft - a.balanceLeft);
    const inactiveArrearsTotal = inactiveArrearsRows.reduce(
      (sum, row) => sum + row.balanceLeft,
      0
    );

    const depositDeductionRows: DepositDeductionReportRow[] = securityDepositDeductions
      .filter((deduction) => {
        const key = dateKey(deduction.deductionDate);
        return key >= rangeStartKey && key <= rangeEndKey;
      })
      .map((deduction) => {
        const tenant = tenantLookup.get(deduction.tenantId);
        const deductionHouse = houseLookup.get(deduction.houseId);
        const tenantHouseId = tenant
          ? typeof tenant.house === "string"
            ? tenant.house
            : tenant.house?.$id ?? ""
          : "";
        const tenantHouse = houseLookup.get(tenantHouseId);
        const house = deductionHouse ?? tenantHouse;
        const houseCode = house?.code?.trim() ?? "";
        const houseName = house?.name?.trim() ?? "";
        return {
          deductionId: deduction.$id,
          tenantId: deduction.tenantId,
          tenantName: tenant?.fullName ?? deduction.tenantId,
          houseLabel:
            houseCode && houseName
              ? `${houseCode} - ${houseName}`
              : houseCode || houseName || "--",
          deductionDateKey: dateKey(deduction.deductionDate),
          deductionDate: formatDisplayDate(deduction.deductionDate),
          itemFixed: deduction.itemFixed?.trim() || "--",
          amount: Number(deduction.amount) || 0,
          deductionNote: deduction.deductionNote?.trim() || "--",
          expenseReference: deduction.expenseReference?.trim() || "--",
        };
      })
      .sort((a, b) => {
        const tenantSort = a.tenantName.localeCompare(b.tenantName);
        if (tenantSort !== 0) return tenantSort;
        return a.deductionDateKey.localeCompare(b.deductionDateKey);
      });

    const tenantIdsWithDeductions = new Set(
      depositDeductionRows.map((row) => row.tenantId)
    );
    const depositBalanceRows: DepositBalanceRow[] = Array.from(tenantIdsWithDeductions)
      .map((tenantId) => {
        const tenant = tenantLookup.get(tenantId);
        const depositPaid = Math.max(Number(tenant?.securityDepositPaid) || 0, 0);
        const deductionRowsForTenant = securityDepositDeductions.filter(
          (entry) => entry.tenantId === tenantId
        );
        const deductionsBeforeRange = deductionRowsForTenant.reduce((sum, entry) => {
          const key = dateKey(entry.deductionDate);
          if (key >= rangeStartKey) return sum;
          return sum + (Number(entry.amount) || 0);
        }, 0);
        const deductionsInRange = deductionRowsForTenant.reduce((sum, entry) => {
          const key = dateKey(entry.deductionDate);
          if (key < rangeStartKey || key > rangeEndKey) return sum;
          return sum + (Number(entry.amount) || 0);
        }, 0);
        const openingBalance = depositPaid - deductionsBeforeRange;
        const closingBalance = openingBalance - deductionsInRange;
        const houseId = tenant
          ? typeof tenant.house === "string"
            ? tenant.house
            : tenant.house?.$id ?? ""
          : "";
        const house = houseLookup.get(houseId);
        const houseCode = house?.code?.trim() ?? "";
        const houseName = house?.name?.trim() ?? "";
        return {
          tenantId,
          tenantName: tenant?.fullName ?? tenantId,
          houseLabel:
            houseCode && houseName
              ? `${houseCode} - ${houseName}`
              : houseCode || houseName || "--",
          depositPaid,
          openingBalance,
          deductedInRange: deductionsInRange,
          closingBalance,
          deductionsInRangeCount: deductionRowsForTenant.filter((entry) => {
            const key = dateKey(entry.deductionDate);
            return key >= rangeStartKey && key <= rangeEndKey;
          }).length,
        };
      })
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));

    const depositDeductionsTotal = depositDeductionRows.reduce(
      (sum, row) => sum + row.amount,
      0
    );
    const openingDepositBalanceTotal = depositBalanceRows.reduce(
      (sum, row) => sum + row.openingBalance,
      0
    );
    const closingDepositBalanceTotal = depositBalanceRows.reduce(
      (sum, row) => sum + row.closingBalance,
      0
    );
    const depositTenantsAffectedCount = depositBalanceRows.length;
    const depositDeductionsCount = depositDeductionRows.length;

    const reportMonthKey = rangeEndMonth;
    const reportMonthDate = parseISO(`${reportMonthKey}-01`);
    const reportMonthStart = startOfMonth(reportMonthDate);
    const reportMonthEnd = endOfMonth(reportMonthDate);
    const nextMonthDate = addMonths(reportMonthDate, 1);
    const nextMonthKey = format(nextMonthDate, "yyyy-MM");
    const reportMonthLabel = formatShortMonth(reportMonthDate);
    const nextMonthLabel = formatShortMonth(nextMonthDate);

    const monthlyTenancyRows: MonthlyTenantStatusRow[] = tenants
      .filter((tenant) => {
        const moveIn = parseISO(tenant.moveInDate);
        const moveOut = getTenantEffectiveEndDate(tenant, reportMonthEnd);
        if (moveIn > reportMonthEnd) return false;
        if (moveOut < reportMonthStart) return false;
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
        const monthsToReport = buildTenantMonthSeries(tenant, reportMonthDate);
        const monthsForRates = Array.from(
          new Set([...monthsToReport, reportMonthKey, nextMonthKey])
        );
        const rentByMonth = buildRentByMonth({
          months: monthsForRates,
          tenantHistoryJson: tenant.rentHistoryJson ?? null,
          houseHistoryJson: house?.rentHistoryJson ?? null,
          fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
          occupancyStartDate: tenant.moveInDate,
          occupancyEndDate: getOccupancyEndDateKey(tenant, reportMonthEnd),
        });
        const expectedUpToReport = monthsToReport.reduce(
          (sum, month) => sum + (rentByMonth[month] ?? 0),
          0
        );
        const paidUpToReport = monthsToReport.reduce(
          (sum, month) => sum + (paidByMonth[month] ?? 0),
          0
        );
        const monthsInSelectedRange = monthsToReport.filter(
          (month) => month >= rangeStartMonth && month <= rangeEndMonth
        );
        const rate = rentByMonth[reportMonthKey] ?? 0;
        const nextRate = rentByMonth[nextMonthKey] ?? rate;
        const rentPaid = isMonthRange
          ? paidByMonth[reportMonthKey] ?? 0
          : monthsInSelectedRange.reduce(
              (sum, month) => sum + (paidByMonth[month] ?? 0),
              0
            );
        const balance = Math.max(expectedUpToReport - paidUpToReport, 0);
        const paymentEntriesInRange = isMonthRange
          ? paymentSummaryByMonth[reportMonthKey] ?? []
          : monthsInSelectedRange.flatMap(
              (month) => paymentSummaryByMonth[month] ?? []
            );
        const paymentDatesInRange = paymentEntriesInRange
          .filter((item) => item.amount > 0)
          .map((item) => item.paymentDate)
          .sort((a, b) => a.localeCompare(b));
        const latestPaymentDate =
          paymentDatesInRange.length > 0
            ? formatDisplayDate(
                paymentDatesInRange[paymentDatesInRange.length - 1],
                "N/A"
              )
            : "N/A";
        const statusNote = isMonthRange
          ? getLatestPaymentNoteForMonth(tenantPayments, reportMonthKey)
          : getLatestPaymentNoteForRange(
              tenantPayments,
              rangeStartMonth,
              rangeEndMonth
            );
        const status = statusNote ?? "No note";
        const moveOutDate =
          tenant.moveOutDate &&
          tenant.moveOutDate.slice(0, 10) >= rangeStartKey &&
          tenant.moveOutDate.slice(0, 10) <= rangeEndKey
            ? formatDisplayDate(tenant.moveOutDate)
            : null;

        const houseName = house?.name?.trim() ?? "";
        const houseCode = house?.code?.trim() ?? "";
        const unitNo =
          houseCode && houseName
            ? `${houseCode}\n${houseName}`
            : houseCode || houseName || "--";

        return {
          tenantId: tenant.$id,
          unitNo,
          tenantName: tenant.fullName,
          contact: tenant.phone?.trim() || "N/A",
          rate,
          nextRate,
          rentPaid,
          balance,
          datePaid: latestPaymentDate,
          moveOutDate,
          status,
          statusNote,
        };
      })
      .sort((a, b) => {
        const unitSort = a.unitNo.localeCompare(b.unitNo);
        if (unitSort !== 0) return unitSort;
        return a.tenantName.localeCompare(b.tenantName);
      });

    const rentExpectedThisMonth = isMonthRange
      ? monthlyTenancyRows.reduce((sum, row) => sum + row.rate, 0)
      : tenants.reduce((sum, tenant) => {
          const houseId =
            typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
          const house = houseLookup.get(houseId);
          const months = buildTenantMonthSeries(tenant, range.end).filter(
            (month) => month >= rangeStartMonth && month <= rangeEndMonth
          );
          if (months.length === 0) return sum;
          const rentByMonth = buildRentByMonth({
            months,
            tenantHistoryJson: tenant.rentHistoryJson ?? null,
            houseHistoryJson: house?.rentHistoryJson ?? null,
            fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
            occupancyStartDate: tenant.moveInDate,
            occupancyEndDate: getOccupancyEndDateKey(tenant, range.end),
          });
          return sum + months.reduce((monthSum, month) => monthSum + (rentByMonth[month] ?? 0), 0);
        }, 0);
    const amountPaidThisMonth = roundMoney(paidInRange);
    const unpaidRentThisMonth = Math.max(rentExpectedThisMonth - amountPaidThisMonth, 0);
    const nextMonthEnd = endOfMonth(nextMonthDate);
    const rentExpectedNextMonth = tenants.reduce((sum, tenant) => {
      const moveIn = parseISO(tenant.moveInDate);
      if (moveIn > nextMonthEnd) return sum;
      if (isTenantInactiveAtDate(tenant, nextMonthEnd)) return sum;
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const house = houseLookup.get(houseId);
      const rentByMonth = buildRentByMonth({
        months: [nextMonthKey],
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
        occupancyStartDate: tenant.moveInDate,
        occupancyEndDate: getOccupancyEndDateKey(tenant, nextMonthEnd),
      });
      return sum + (rentByMonth[nextMonthKey] ?? 0);
    }, 0);
    const tenantsWithArrearsCount = arrearsRows.filter(
      (row) => row.statusLabel === "active" && row.balance > 0
    ).length;
    const hasMoveOutInSelectedRange = monthlyTenancyRows.some(
      (row) => Boolean(row.moveOutDate)
    );

    const expensesForReportMonth = isMonthRange
      ? expenses.filter((expense) => expense.expenseDate?.slice(0, 7) === reportMonthKey)
      : expensesInRange;
    const rentCashExpensesForReportMonth = expensesForReportMonth.filter(
      (expense) => expense.source === "rent_cash"
    );
    const disbursementMap = new Map<string, number>();
    expensesForReportMonth.forEach((expense) => {
      const label = expense.description?.trim()
        ? expense.description.trim()
        : expense.category === "maintenance"
          ? "Maintenance"
          : "General Expense";
      const sourceLabel = expense.source === "rent_cash" ? "Rent Cash" : "External";
      const rowLabel = `${label} (${sourceLabel})`;
      disbursementMap.set(rowLabel, (disbursementMap.get(rowLabel) ?? 0) + expense.amount);
    });
    const disbursementRows: DisbursementRow[] = Array.from(disbursementMap.entries()).map(
      ([label, amount]) => ({ label, amount })
    );
    const totalDisbursements = disbursementRows.reduce(
      (sum, row) => sum + row.amount,
      0
    );
    const totalRentCashDisbursements = rentCashExpensesForReportMonth.reduce(
      (sum, expense) => sum + expense.amount,
      0
    );
    const totalCashToLandlord = amountPaidThisMonth - totalRentCashDisbursements;
    const totalExpectedNextMonth = rentExpectedNextMonth + totalTenantBalance;
    const reportPeriodLabel = isMonthRange
      ? reportMonthLabel
      : `${rangeStartDisplay} to ${rangeEndDisplay}`;

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
    const selectedTenantEnd = selectedTenant
      ? getTenantEffectiveEndDate(selectedTenant, today)
      : today;
    const allMonths = selectedTenant
      ? buildTenantMonthSeries(selectedTenant, today)
      : [];
    const monthsInRange = allMonths;
    const rentByMonth = selectedTenant
      ? buildRentByMonth({
          months: monthsInRange,
          tenantHistoryJson: selectedTenant.rentHistoryJson ?? null,
          houseHistoryJson: selectedHouse?.rentHistoryJson ?? null,
          fallbackRent:
            selectedTenant.rentOverride ?? selectedHouse?.monthlyRent ?? 0,
          occupancyStartDate: selectedTenant.moveInDate,
          occupancyEndDate: getOccupancyEndDateKey(selectedTenant, today),
        })
      : {};
    const tenantDetailRows = monthsInRange.map((month) => {
      const expected = rentByMonth[month] ?? 0;
      const paid = paidByMonth[month] ?? 0;
      const balance = Math.max(expected - paid, 0);
      return {
        month: formatShortMonth(month),
        expected,
        paid,
        balance,
        payments: (paymentSummaryByMonth[month] ?? []).map((payment) => ({
          ...payment,
          paymentDate: formatDisplayDate(payment.paymentDate),
        })),
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
    const tenantDetailCurrentDateKey = formatDisplayDate(today);
    const tenantDetailStatusLabel = selectedTenant
      ? selectedTenant.status === "active" && !selectedTenant.moveOutDate
        ? "active"
        : "inactive"
      : "";

    return {
      paidInRange,
      expensesInRange,
      range,
      rangeStartKey,
      rangeEndKey,
      rangeStartDisplay,
      rangeEndDisplay,
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
      inactiveArrearsRows,
      inactiveArrearsTotal,
      depositDeductionRows,
      depositBalanceRows,
      depositDeductionsTotal,
      openingDepositBalanceTotal,
      closingDepositBalanceTotal,
      depositTenantsAffectedCount,
      depositDeductionsCount,
      currentDateKey,
      reportMonthKey,
      reportMonthLabel,
      reportPeriodLabel,
      isMonthRange,
      nextMonthLabel,
      monthlyTenancyRows,
      hasMoveOutInSelectedRange,
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
    securityDepositDeductions,
    selectedTenantId,
  ]);

  const exportXlsx = () => {
    setExportingXlsx(true);
    try {
      if (!ensureExportAllowed()) {
        return;
      }
      if (reportType === "tenantDetail" && !summary.selectedTenant) {
        toast.push("warning", "Select a tenant first.");
        return;
      }

      const workbook = XLSX.utils.book_new();
      const trimmedPersonalNote = personalReportNote.trim();
      const personalNoteRows =
        trimmedPersonalNote.length > 0
          ? [{ Note: "Personal note", Value: trimmedPersonalNote }]
          : [];

      if (reportType === "tenantDetail" && summary.selectedTenant) {
        const tenantHeaderRows = [
          {
            Tenant: summary.selectedTenant.fullName,
            House: summary.selectedHouse?.code ?? "--",
            MoveInDate: formatDisplayDate(summary.selectedTenant.moveInDate, ""),
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
            PaymentDate: formatDisplayDate(payment.paymentDate, ""),
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
        if (personalNoteRows.length > 0) {
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(personalNoteRows),
            "Notes"
          );
        }
      } else if (reportType === "inactiveArrears") {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.inactiveArrearsRows.map((row) => ({
              Tenant: row.tenantName,
              House: row.houseLabel,
              MoveInDate: row.moveInDate,
              MoveOutDate: row.moveOutDate,
              TotalPaid: row.totalPaid,
              BalanceLeft: row.balanceLeft,
            }))
          ),
          "InactiveArrears"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet([
            { Note: "Range", Value: summary.reportPeriodLabel },
            { Note: "Inactive tenants with arrears", Value: summary.inactiveArrearsRows.length },
            { Note: "Inactive tenant arrears total", Value: summary.inactiveArrearsTotal },
            ...personalNoteRows,
          ]),
          "Notes"
        );
      } else if (reportType === "depositDeductions") {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.depositDeductionRows.map((row) => ({
              Date: row.deductionDate,
              Tenant: row.tenantName,
              House: row.houseLabel,
              ItemFixed: row.itemFixed,
              Amount: row.amount,
              Note: row.deductionNote === "--" ? "" : row.deductionNote,
            }))
          ),
          "DepositDeductions"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.depositBalanceRows.map((row) => ({
              Tenant: row.tenantName,
              House: row.houseLabel,
              DepositPaid: row.depositPaid,
              OpeningBalance: row.openingBalance,
              DeductionsInRange: row.deductedInRange,
              ClosingBalance: row.closingBalance,
              DeductionsCount: row.deductionsInRangeCount,
            }))
          ),
          "TenantBalances"
        );

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet([
            { Note: "Range", Value: summary.reportPeriodLabel },
            { Note: "Deduction entries", Value: summary.depositDeductionsCount },
            { Note: "Tenants affected", Value: summary.depositTenantsAffectedCount },
            { Note: "Total deductions", Value: summary.depositDeductionsTotal },
            {
              Note: "Total opening balance (affected tenants)",
              Value: summary.openingDepositBalanceTotal,
            },
            {
              Note: "Total closing balance (affected tenants)",
              Value: summary.closingDepositBalanceTotal,
            },
            ...personalNoteRows,
          ]),
          "Notes"
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
        if (personalNoteRows.length > 0) {
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(personalNoteRows),
            "Notes"
          );
        }
      } else {
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
              ...(summary.hasMoveOutInSelectedRange
                ? { MoveOutDate: row.moveOutDate ?? "" }
                : {}),
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
            { Note: `Report Period`, Value: summary.reportPeriodLabel },
            {
              Note: summary.isMonthRange
                ? "Rent expected this month"
                : "Rent expected in selected range",
              Value: summary.rentExpectedThisMonth,
            },
            {
              Note: summary.isMonthRange
                ? "Amount of rent collected this month"
                : "Amount of rent collected in selected range",
              Value: summary.amountPaidThisMonth,
            },
            {
              Note: summary.isMonthRange
                ? "Unpaid rent this month"
                : "Unpaid rent in selected range",
              Value: summary.unpaidRentThisMonth,
            },
            {
              Note: summary.isMonthRange
                ? "Total expected next month"
                : "Total expenses in selected range",
              Value: summary.isMonthRange
                ? summary.totalExpectedNextMonth
                : summary.totalDisbursements,
            },
            { Note: "Outstanding total balance", Value: summary.totalTenantBalance },
            {
              Note: "Tenants with arrears",
              Value: summary.tenantsWithArrearsCount,
            },
            ...personalNoteRows,
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
            PaymentDate: formatDisplayDate(payment.paymentDate, ""),
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
          ExpenseDate: formatDisplayDate(expense.expenseDate, ""),
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
          : reportType === "inactiveArrears"
          ? "_Inactive_Tenant_Arrears"
          : reportType === "depositDeductions"
          ? "_Deposit_Deductions"
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
      recordExportAudit("xlsx", fileSuffix ? `report${fileSuffix}` : "report");
    } catch (err) {
      toast.push("error", "Failed to export XLSX report.");
    } finally {
      setExportingXlsx(false);
    }
  };

  const exportPdf = () => {
    setExportingPdf(true);
    try {
      if (!ensureExportAllowed()) {
        return;
      }
      if (reportType === "tenantDetail" && !summary.selectedTenant) {
        toast.push("warning", "Select a tenant first.");
        return;
      }

      const doc = new jsPDF({
        orientation:
          reportType === "summary" ||
          reportType === "inactiveArrears" ||
          reportType === "depositDeductions"
            ? "landscape"
            : "portrait",
      });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      const title =
        reportType === "summary"
          ? summary.isMonthRange
            ? `MONTHLY TENANCY REPORT FOR ${summary.reportMonthLabel.toUpperCase()}`
            : "TENANCY SUMMARY REPORT"
          : reportType === "inactiveArrears"
          ? "INACTIVE TENANT ARREARS REPORT"
          : reportType === "depositDeductions"
          ? "SECURITY DEPOSIT DEDUCTIONS REPORT"
          : reportType === "byHouse"
          ? "RCMS Collections by House"
          : "RCMS Tenant Collection";
      doc.text(title, 14, 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      let y = 28;
      if (reportType === "summary" && !summary.isMonthRange) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Range: ${summary.reportPeriodLabel}`, 14, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
      }
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const left = 14;
      const right = pageWidth - 14;
      const bottom = pageHeight - 20;
      const trimmedPersonalNote = personalReportNote.trim();

      const ensureSpace = (height: number) => {
        if (y + height > bottom) {
          doc.addPage();
          y = 20;
        }
      };

      const drawTable = (
        headers: string[],
        rows: string[][],
        options?: {
          columnWidths?: number[];
          wrapColumnIndexes?: number[];
          boldRowIndexes?: number[];
        }
      ) => {
        const tableWidth = right - left;
        const baseWidth = tableWidth / headers.length;
        const requestedWidths =
          options?.columnWidths?.length === headers.length
            ? options.columnWidths
            : new Array(headers.length).fill(baseWidth);
        const wrapColumns = new Set(options?.wrapColumnIndexes ?? []);
        const boldRows = new Set(options?.boldRowIndexes ?? []);
        const requestedTotal = requestedWidths.reduce((sum, width) => sum + width, 0);
        const scale = requestedTotal > 0 ? tableWidth / requestedTotal : 1;
        const columnWidths = requestedWidths.map((width) => width * scale);
        const computedLineHeight =
          (doc.getFontSize() / doc.internal.scaleFactor) *
          doc.getLineHeightFactor();
        const lineHeight = Math.max(computedLineHeight, 4);
        const minRowHeight = lineHeight + 4;
        const cellPaddingX = 2;
        const textOffsetY = lineHeight;

        const fitLineToWidth = (value: string, width: number) => {
          const maxTextWidth = Math.max(width - cellPaddingX * 2, 6);
          const source = String(value ?? "");
          if (!source) return "";
          if (doc.getTextWidth(source) <= maxTextWidth) return source;
          const ellipsis = "...";
          if (doc.getTextWidth(ellipsis) >= maxTextWidth) return "";
          let end = source.length;
          while (end > 0) {
            const candidate = `${source.slice(0, end)}${ellipsis}`;
            if (doc.getTextWidth(candidate) <= maxTextWidth) {
              return candidate;
            }
            end -= 1;
          }
          return "";
        };

        const splitHeaderCell = (value: string, width: number) => {
          const text = String(value ?? "");
          const maxTextWidth = Math.max(width - cellPaddingX * 2, 6);
          return doc.splitTextToSize(text, maxTextWidth) as string[];
        };

        const splitBodyCell = (value: string, width: number, columnIndex: number) => {
          const text = String(value ?? "");
          if (!text) return [""];
          const explicitLines = text.split(/\r?\n/);
          if (wrapColumns.has(columnIndex)) {
            const maxTextWidth = Math.max(width - cellPaddingX * 2, 6);
            return explicitLines.flatMap((line) => {
              const wrapped = doc.splitTextToSize(line, maxTextWidth) as string[];
              return wrapped.length > 0 ? wrapped : [""];
            });
          }
          return explicitLines.map((line) => fitLineToWidth(line, width));
        };

        const drawHeader = () => {
          const headerLines = headers.map((header, index) =>
            splitHeaderCell(header, columnWidths[index])
          );
          const headerLineCount = Math.max(
            ...headerLines.map((lines) => Math.max(lines.length, 1))
          );
          const headerHeight = Math.max(minRowHeight, headerLineCount * lineHeight + 4);
          ensureSpace(headerHeight);

          doc.setDrawColor(229, 231, 235);
          doc.setTextColor(17, 24, 39);
          doc.setFont("helvetica", "bold");
          let x = left;
          headers.forEach((_, index) => {
            const width = columnWidths[index];
            doc.rect(x, y, width, headerHeight, "S");
            doc.text(headerLines[index], x + cellPaddingX, y + textOffsetY);
            x += width;
          });
          doc.setFont("helvetica", "normal");
          y += headerHeight;
        };

        drawHeader();

        doc.setDrawColor(229, 231, 235);
        doc.setTextColor(17, 24, 39);
        rows.forEach((row, rowIndex) => {
          const rowLines = headers.map((_, index) =>
            splitBodyCell(row[index] ?? "", columnWidths[index], index)
          );
          const lineCount = Math.max(...rowLines.map((lines) => Math.max(lines.length, 1)));
          const rowHeight = Math.max(minRowHeight, lineCount * lineHeight + 4);
          if (y + rowHeight > bottom) {
            doc.addPage();
            y = 20;
            drawHeader();
          }

          let x = left;
          doc.setFont("helvetica", boldRows.has(rowIndex) ? "bold" : "normal");
          headers.forEach((_, index) => {
            const width = columnWidths[index];
            doc.rect(x, y, width, rowHeight);
            doc.text(rowLines[index], x + cellPaddingX, y + textOffsetY);
            x += width;
          });
          doc.setFont("helvetica", "normal");
          y += rowHeight;
        });

        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        doc.setFillColor(255, 255, 255);
        y += 6;
      };

      const summaryTableHeaders = [
        "Unit No.",
        "Tenant Name",
        "Contact",
        "Rate",
        "Rent Paid",
        "Balance",
        "Date Paid",
        ...(summary.hasMoveOutInSelectedRange ? ["Move-out Date"] : []),
        "Status",
      ];
      const summaryColumnWidths = summary.hasMoveOutInSelectedRange
        ? [18, 22, 22, 14, 16, 16, 14, 14, 46]
        : [20, 24, 22, 14, 16, 16, 14, 56];

      const summaryTableRows = summary.monthlyTenancyRows.map((row) => [
        row.unitNo,
        row.tenantName,
        row.contact,
        row.rate > 0 ? ush(row.rate) : "NIL",
        row.rentPaid > 0 ? ush(row.rentPaid) : "NIL",
        row.balance > 0 ? ush(row.balance) : "NIL",
        row.datePaid,
        ...(summary.hasMoveOutInSelectedRange ? [row.moveOutDate ?? "--"] : []),
        row.status,
      ]);

      const byHouseHeaders = ["House", "Collected", "Owed", "Occupancy"];
      const byHouseRows = summary.byHouseRangeRows.map((row) => [
        row.houseCode,
        currency(row.collected),
        currency(row.owed),
        row.occupancyStatus,
      ]);
      const byHouseColumnWidths = [40, 42, 40, 60];


      const drawPersonalNote = () => {
        if (!trimmedPersonalNote) return;
        const wrapped = doc.splitTextToSize(
          trimmedPersonalNote,
          right - left - 8
        ) as string[];
        ensureSpace(12 + wrapped.length * 5);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Personal note:", left, y);
        doc.setFont("helvetica", "normal");
        y += 5;
        wrapped.forEach((line) => {
          doc.text(line, left + 4, y);
          y += 5;
        });
        y += 2;
        doc.setFontSize(11);
      };

      if (reportType !== "summary") {
        drawPersonalNote();
      }

      if (reportType === "byHouse") {
        drawTable(byHouseHeaders, byHouseRows, { columnWidths: byHouseColumnWidths });
      }
      if (reportType === "inactiveArrears") {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Range: ${summary.reportPeriodLabel}`, left, y);
        y += 6;
        doc.text(
          `Inactive tenant arrears total: ${ush(summary.inactiveArrearsTotal)} (${summary.inactiveArrearsRows.length} tenant(s))`,
          left,
          y
        );
        doc.setFont("helvetica", "normal");
        y += 6;
        doc.setFontSize(11);
        drawTable(
          ["Tenant", "House", "Move-in", "Move-out", "Total Paid", "Balance Left"],
          summary.inactiveArrearsRows.map((row) => [
            row.tenantName,
            row.houseLabel,
            row.moveInDate,
            row.moveOutDate,
            ush(row.totalPaid),
            ush(row.balanceLeft),
          ]),
          { columnWidths: [34, 20, 17, 17, 16, 16] }
        );
      }
      if (reportType === "depositDeductions") {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Range: ${summary.reportPeriodLabel}`, left, y);
        y += 6;
        doc.text(`Date: ${summary.currentDateKey}`, left, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.text(
          `Deduction entries: ${summary.depositDeductionsCount} | Tenants affected: ${summary.depositTenantsAffectedCount} | Total deductions: ${ush(summary.depositDeductionsTotal)}`,
          left,
          y
        );
        y += 8;
        drawTable(
          ["Date", "Tenant", "House", "Item Fixed", "Amount", "Note"],
          summary.depositDeductionRows.map((row) => [
            row.deductionDate,
            row.tenantName,
            row.houseLabel,
            row.itemFixed,
            ush(row.amount),
            row.deductionNote,
          ]),
          {
            columnWidths: [14, 26, 22, 24, 14, 34],
            wrapColumnIndexes: [1, 2, 3, 5],
          }
        );
        drawTable(
          [
            "Tenant",
            "House",
            "Deposit Paid",
            "Opening Balance",
            "Deductions In Range",
            "Closing Balance",
          ],
          summary.depositBalanceRows.map((row) => [
            row.tenantName,
            row.houseLabel,
            ush(row.depositPaid),
            ush(row.openingBalance),
            ush(row.deductedInRange),
            ush(row.closingBalance),
          ]),
          { columnWidths: [24, 22, 16, 16, 16, 16] }
        );
        ensureSpace(16);
        doc.setFont("helvetica", "bold");
        doc.text(
          `Total opening balance (affected tenants): ${ush(summary.openingDepositBalanceTotal)}`,
          left,
          y
        );
        y += 6;
        doc.text(
          `Total closing balance (affected tenants): ${ush(summary.closingDepositBalanceTotal)}`,
          left,
          y
        );
        doc.setFont("helvetica", "normal");
      }
      if (reportType === "summary") {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Date: ${summary.currentDateKey}`, left, y);
        y += 6;
        doc.text("Summary of Tenants' Payment Status", left, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);

        drawTable(summaryTableHeaders, summaryTableRows, {
          columnWidths: summaryColumnWidths,
          wrapColumnIndexes: [1, summaryTableHeaders.length - 1],
        });

        drawTable(
          ["Summary of Disbursements", "Amount"],
          [
            ["Total Rent Collected", ush(summary.amountPaidThisMonth)],
            ...summary.disbursementRows.map((row) => [row.label, ush(row.amount)]),
            ["Total cash to transfer to Landlord", ush(summary.totalCashToLandlord)],
          ],
          { boldRowIndexes: [0, summary.disbursementRows.length + 1] }
        );

        ensureSpace(40);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Notes:", left, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`1. This is a summary of payments as of ${summary.currentDateKey}.`, left + 4, y);
        y += 5;
        doc.setFont("helvetica", "bold");
        doc.text("2. Breakdown of totals:", left + 4, y);
        doc.setFont("helvetica", "normal");
        y += 5;
        doc.text(
          summary.isMonthRange
            ? `a) Rent expected this month: ${ush(summary.rentExpectedThisMonth)}`
            : `a) Rent expected in selected range: ${ush(summary.rentExpectedThisMonth)}`,
          left + 8,
          y
        );
        y += 5;
        doc.text(
          summary.isMonthRange
            ? `b) Amount of rent collected this month: ${ush(summary.amountPaidThisMonth)}`
            : `b) Amount of rent collected in selected range: ${ush(summary.amountPaidThisMonth)}`,
          left + 8,
          y
        );
        y += 5;
        doc.text(
          summary.isMonthRange
            ? `c) Unpaid rent this month: ${ush(summary.unpaidRentThisMonth)}`
            : `c) Unpaid rent in selected range: ${ush(summary.unpaidRentThisMonth)}`,
          left + 8,
          y
        );
        y += 5;
        doc.text(
          summary.isMonthRange
            ? `d) Total expected next month: ${ush(summary.totalExpectedNextMonth)}`
            : `d) Total expenses in selected range: ${ush(summary.totalDisbursements)}`,
          left + 8,
          y
        );
        y += 5;
        doc.setFont("helvetica", "bold");
        doc.text(`e) Outstanding total balance: ${ush(summary.totalTenantBalance)}`, left + 8, y);
        doc.setFont("helvetica", "normal");
        y += 5;
        doc.text(
          `3. ${summary.tenantsWithArrearsCount} tenant(s) remained with arrears to be collected in the next month.`,
          left + 4,
          y
        );
        y += 5;

        if (trimmedPersonalNote) {
          const wrapped = doc.splitTextToSize(
            trimmedPersonalNote,
            right - left - 12
          ) as string[];
          ensureSpace(5 + wrapped.length * 5);
          doc.setFont("helvetica", "bold");
          doc.text("4. Personal note:", left + 4, y);
          doc.setFont("helvetica", "normal");
          y += 5;
          wrapped.forEach((line) => {
            doc.text(line, left + 8, y);
            y += 5;
          });
        }

        const fileSuffix = `_${summary.reportMonthKey.replace("-", "")}`;
        const startFileKey = format(summary.range.start, "yyyyMMdd");
        const endFileKey = format(summary.range.end, "yyyyMMdd");
        doc.save(
          `RCMS_Monthly_Tenancy_Report${fileSuffix}_${startFileKey}_${endFileKey}.pdf`
        );
        toast.push("success", "Report exported as PDF.");
        recordExportAudit("pdf", `monthly_tenancy${fileSuffix}`);
        return;
      }

      if (reportType === "tenantDetail" && summary.selectedTenant) {
        drawTable(
          ["Tenant", "Move-in", "Current Date", "Status"],
          [[
            summary.selectedTenant.fullName,
            formatDisplayDate(summary.selectedTenant.moveInDate),
            summary.tenantDetailCurrentDateKey || "--",
            summary.tenantDetailStatusLabel || "--",
          ]]
        );
        drawTable(
          ["Month", "Paid", "Arrears"],
          [
            ...summary.tenantDetailRows.map((row) => [
              row.month,
              currency(row.paid),
              currency(row.balance),
            ]),
            [
            "Totals",
            currency(summary.tenantDetailTotals.paid),
            currency(summary.tenantDetailTotals.balance),
            ],
          ]
        );
      }
      const fileSuffix =
        reportType === "tenantDetail" && summary.selectedTenant
          ? `_${summary.selectedTenant.fullName.replace(/\s+/g, "_")}`
          : reportType === "inactiveArrears"
          ? "_Inactive_Tenant_Arrears"
          : reportType === "depositDeductions"
          ? "_Deposit_Deductions"
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
      recordExportAudit("pdf", fileSuffix ? `report${fileSuffix}` : "report");
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
            <option value="inactiveArrears">Inactive Arrears</option>
            <option value="depositDeductions">Deposit Deductions</option>
          </select>
        </label>
        {reportType === "tenantDetail" && (
          <div className="min-w-[260px] max-w-[460px] flex-1">
            <TypeaheadField
              label="Tenant"
              placeholder="Type tenant name, phone, or house"
              value={selectedTenantId}
              options={tenantSelectionOptions}
              maxResults={Math.max(8, tenants.length)}
              onChange={setSelectedTenantId}
              disabled={loading || tenants.length === 0}
              emptyStateText="No tenant matches your search."
            />
          </div>
        )}
        {reportType !== "tenantDetail" && (
          <>
            <label className="text-sm text-slate-300">
              Sort by
              <select
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={rangeMode}
                onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}
              >
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="custom">Custom Date</option>
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
                <select
                  className="input-base ml-3 w-32 rounded-md px-3 py-2 text-sm"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                >
                  {yearOptions.map((yearOption) => (
                    <option key={yearOption} value={yearOption}>
                      {yearOption}
                    </option>
                  ))}
                </select>
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
          type="button"
          onClick={() => setNoteEditorOpen((open) => !open)}
          className="btn-secondary text-sm"
        >
          {noteEditorOpen ? "Hide Personal Note" : "Add Personal Note"}
        </button>
        <button
          onClick={loadData}
          className="btn-secondary text-sm"
        >
          Refresh
        </button>
        <button
          onClick={exportXlsx}
          className="btn-primary text-sm"
          disabled={loading || exportingXlsx || exportLimitStatus.reached}
        >
          {exportingXlsx
            ? "Exporting..."
            : exportLimitStatus.reached
              ? "Export XLSX (Locked)"
              : "Export XLSX"}
        </button>
        <button
          onClick={exportPdf}
          className="btn-secondary text-sm"
          disabled={loading || exportingPdf || exportLimitStatus.reached}
        >
          {exportingPdf
            ? "Exporting..."
            : exportLimitStatus.reached
              ? "Export PDF (Locked)"
              : "Export PDF"}
        </button>
        {exportLimitStatus.reached ? (
          <Link to="/app/upgrade" className="btn-secondary text-sm">
            Upgrade Plan
          </Link>
        ) : null}
        {planLimits.exportsPerMonth != null && (
          <div className="text-xs text-amber-300">
            Exports this month: {exportLimitStatus.used.toLocaleString()} /{" "}
            {formatLimitValue(exportLimitStatus.limit)}
            {exportLimitStatus.reached ? " (limit reached)" : ""}
          </div>
        )}
      </div>

      {noteEditorOpen && (
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <label className="block text-sm text-slate-300">
            Personal note for export (optional)
            <textarea
              rows={3}
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              value={personalReportNote}
              onChange={(event) => setPersonalReportNote(event.target.value)}
              placeholder="Add a note to include in exported PDF/XLSX reports."
            />
          </label>
        </div>
      )}

      {reportType === "summary" && (
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">
              {summary.isMonthRange
                ? `Monthly Tenancy Report For ${summary.reportMonthLabel}`
                : `Tenancy Summary Report (${summary.reportPeriodLabel})`}
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
                    <th className="w-48 px-4 py-3">Tenant Name</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Rate</th>
                    <th className="px-4 py-3">Rent Paid</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3">Date Paid</th>
                    {summary.hasMoveOutInSelectedRange && (
                      <th className="px-4 py-3">Move-out Date</th>
                    )}
                    <th className="w-[22rem] px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.monthlyTenancyRows.map((row) => (
                    <tr
                      key={row.tenantId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-200 whitespace-pre-line break-words">
                        {row.unitNo}
                      </td>
                      <td className="px-4 py-3 text-slate-100 whitespace-normal break-words">
                        <div className="max-w-[12rem]">{row.tenantName}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.contact}</td>
                      <td className="amount px-4 py-3">{row.rate > 0 ? ush(row.rate) : "NIL"}</td>
                      <td className="amount px-4 py-3">
                        {row.rentPaid > 0 ? ush(row.rentPaid) : "NIL"}
                      </td>
                      <td className="amount px-4 py-3 text-rose-200">
                        {row.balance > 0 ? ush(row.balance) : "NIL"}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.datePaid}</td>
                      {summary.hasMoveOutInSelectedRange && (
                        <td className="px-4 py-3 text-slate-400">{row.moveOutDate ?? "--"}</td>
                      )}
                      <td className="px-4 py-3 text-slate-300 whitespace-normal break-words">
                        <div className="max-w-[22rem]">{row.status}</div>
                      </td>
                    </tr>
                  ))}
                  {summary.monthlyTenancyRows.length === 0 && (
                    <tr>
                      <td
                        className="px-4 py-4 text-slate-500"
                        colSpan={summary.hasMoveOutInSelectedRange ? 9 : 8}
                      >
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
              Expenses in {summary.reportPeriodLabel} (Rent Cash and External)
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
              <div className="pl-4">
                {summary.isMonthRange
                  ? `a. Rent expected this month: ${ush(summary.rentExpectedThisMonth)}`
                  : `a. Rent expected in selected range: ${ush(summary.rentExpectedThisMonth)}`}
              </div>
              <div className="pl-4">
                {summary.isMonthRange
                  ? `b. Amount of rent collected this month: ${ush(summary.amountPaidThisMonth)}`
                  : `b. Amount of rent collected in selected range: ${ush(summary.amountPaidThisMonth)}`}
              </div>
              <div className="pl-4">
                {summary.isMonthRange
                  ? `c. Unpaid rent this month: ${ush(summary.unpaidRentThisMonth)}`
                  : `c. Unpaid rent in selected range: ${ush(summary.unpaidRentThisMonth)}`}
              </div>
              <div className="pl-4">
                {summary.isMonthRange
                  ? `d. Total Expected next month: ${ush(summary.totalExpectedNextMonth)}`
                  : `d. Total expenses in selected range: ${ush(summary.totalDisbursements)}`}
              </div>
              <div className="pl-4">e. Outstanding total balance: {ush(summary.totalTenantBalance)}</div>
              <div>
                3. {summary.tenantsWithArrearsCount} tenant(s) remained with arrears. This is to be collected in {summary.nextMonthLabel}.
              </div>
            </div>
          </div>
        </div>
      )}

      {reportType === "inactiveArrears" && (
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">
              Inactive Tenant Arrears Report
            </div>
            <div className="mt-2 text-center text-xs text-slate-500">
              Range: {summary.reportPeriodLabel}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.1em] text-slate-500">
                  Inactive Tenants With Arrears
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {summary.inactiveArrearsRows.length}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.1em] text-slate-500">
                  Cumulative Balance Left
                </div>
                <div className="amount mt-2 text-lg font-semibold text-rose-200">
                  {ush(summary.inactiveArrearsTotal)}
                </div>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[900px] w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">House</th>
                    <th className="px-4 py-3">Move-in Date</th>
                    <th className="px-4 py-3">Move-out Date</th>
                    <th className="px-4 py-3">Total Paid</th>
                    <th className="px-4 py-3">Balance Left</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.inactiveArrearsRows.map((row) => (
                    <tr
                      key={row.tenantId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-400">{row.houseLabel}</td>
                      <td className="px-4 py-3 text-slate-400">{row.moveInDate}</td>
                      <td className="px-4 py-3 text-slate-400">{row.moveOutDate}</td>
                      <td className="amount px-4 py-3 text-slate-200">{ush(row.totalPaid)}</td>
                      <td className="amount px-4 py-3 text-rose-200">{ush(row.balanceLeft)}</td>
                    </tr>
                  ))}
                  {summary.inactiveArrearsRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={6}>
                        No inactive tenants with arrears in selected range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {reportType === "depositDeductions" && (
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">
              Security Deposit Deductions Report
            </div>
            <div className="mt-2 text-center text-xs text-slate-500">
              Range: {summary.reportPeriodLabel}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.1em] text-slate-500">
                  Deduction Entries
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {summary.depositDeductionsCount}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.1em] text-slate-500">
                  Tenants Affected
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {summary.depositTenantsAffectedCount}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.1em] text-slate-500">
                  Total Deductions
                </div>
                <div className="amount mt-2 text-lg font-semibold text-rose-200">
                  {ush(summary.depositDeductionsTotal)}
                </div>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[1100px] w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">House</th>
                    <th className="px-4 py-3">Item Fixed</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.depositDeductionRows.map((row) => (
                    <tr
                      key={row.deductionId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-400">{row.deductionDate}</td>
                      <td className="px-4 py-3 text-slate-100">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-300">{row.houseLabel}</td>
                      <td className="px-4 py-3 text-slate-200">{row.itemFixed}</td>
                      <td className="amount px-4 py-3 text-rose-200">{ush(row.amount)}</td>
                      <td className="px-4 py-3 text-slate-300 whitespace-normal break-words">
                        <div className="max-w-[24rem]">{row.deductionNote}</div>
                      </td>
                    </tr>
                  ))}
                  {summary.depositDeductionRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-slate-500">
                        No security deposit deductions found in selected range.
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
              Tenant Deposit Balances (Affected Tenants)
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Opening and closing balances are derived from deposit paid minus ledger deductions.
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[980px] w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">House</th>
                    <th className="px-4 py-3">Deposit Paid</th>
                    <th className="px-4 py-3">Opening Balance</th>
                    <th className="px-4 py-3">Deductions In Range</th>
                    <th className="px-4 py-3">Closing Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.depositBalanceRows.map((row) => (
                    <tr
                      key={row.tenantId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-300">{row.houseLabel}</td>
                      <td className="amount px-4 py-3 text-slate-200">{ush(row.depositPaid)}</td>
                      <td className="amount px-4 py-3 text-slate-200">{ush(row.openingBalance)}</td>
                      <td className="amount px-4 py-3 text-rose-200">{ush(row.deductedInRange)}</td>
                      <td
                        className={[
                          "amount px-4 py-3",
                          row.closingBalance < 0 ? "text-rose-200" : "text-emerald-300",
                        ].join(" ")}
                      >
                        {ush(row.closingBalance)}
                      </td>
                    </tr>
                  ))}
                  {summary.depositBalanceRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-slate-500">
                        No affected tenant balances for selected range.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 font-semibold text-slate-100" colSpan={3}>
                      Totals
                    </td>
                    <td className="amount px-4 py-3 font-semibold text-slate-100">
                      {ush(summary.openingDepositBalanceTotal)}
                    </td>
                    <td className="amount px-4 py-3 font-semibold text-rose-200">
                      {ush(summary.depositDeductionsTotal)}
                    </td>
                    <td className="amount px-4 py-3 font-semibold text-emerald-300">
                      {ush(summary.closingDepositBalanceTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
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
            {summary.rangeStartDisplay} to {summary.rangeEndDisplay}
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
                    Move-in: {formatDisplayDate(summary.selectedTenant.moveInDate)}
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

      {reportType !== "tenantDetail" && reportType !== "depositDeductions" && (
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
                      {formatDisplayDate(payment.paymentDate)} - {payment.method}
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
