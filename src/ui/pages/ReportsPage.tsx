import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import {
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
  expected: number;
  paid: number;
  balance: number;
};

type ExpenseCategoryRow = {
  category: string;
  total: number;
};

function currency(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function dateKey(value: string | Date) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return format(value, "yyyy-MM-dd");
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
    const generalExpenses = expensesInRange
      .filter((expense) => expense.category === "general")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const maintenanceExpenses = expensesInRange
      .filter((expense) => expense.category === "maintenance")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const totalExpenses = generalExpenses + maintenanceExpenses;
    const netCollection = paidInRange - totalExpenses;

    const rows: SummaryRow[] = [
      {
        metric: "Range",
        value: `${rangeStartKey} to ${rangeEndKey}`,
      },
      { metric: "Rent Collected", value: currency(paidInRange) },
      { metric: "General Expenses", value: currency(generalExpenses) },
      { metric: "Maintenance Expenses", value: currency(maintenanceExpenses) },
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

    const arrearsRows: ArrearsRow[] = tenants
      .filter((tenant) => tenant.status === "active")
      .map((tenant) => {
        const houseId =
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
        const house = houseLookup.get(houseId);
        const moveOut = tenant.moveOutDate ? parseISO(tenant.moveOutDate) : null;
        const effectiveEnd = moveOut && moveOut < range.end ? moveOut : range.end;
        const months = buildMonthSeries(tenant.moveInDate, effectiveEnd);
        const monthsInRange = months.filter(
          (month) => month >= rangeStartMonth && month <= rangeEndMonth
        );
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
          expected,
          paid,
          balance,
        };
      })
      .filter((row) => row.balance > 0)
      .sort((a, b) => b.balance - a.balance);

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
    const today = new Date();
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
      tenantDetailRows,
      tenantDetailTotals,
      tenantDetailRangeStartKey,
      tenantDetailRangeEndKey,
      selectedTenant,
      selectedHouse,
      arrearsRows,
      expenseCategoryRows,
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
            Period: `${summary.tenantDetailRangeStartKey} to ${summary.tenantDetailRangeEndKey}`,
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
            summary.tenantDetailRows.map((row) => ({
              Month: row.month,
              PaidForMonth: row.paid,
              ArrearsForMonth: row.balance,
              PaymentDates: row.payments
                .map((payment) => `${payment.paymentDate} (${currency(payment.amount)})`)
                .join("; "),
            }))
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
          XLSX.utils.json_to_sheet(summary.rows),
          "Summary"
        );
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            summary.houseRows.map((row) => ({
              House: row.houseCode,
              Name: row.houseName,
              Total: row.total,
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
          House: expense.house ?? "",
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

      const doc = new jsPDF();
      doc.setFontSize(16);
      const title =
        reportType === "summary"
          ? "RCMS Summary"
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

      if (reportType !== "tenantDetail") {
        drawTable(
          ["Metric", "Value"],
          summary.rows.map((row) => [row.metric, row.value])
        );
      }
      if (reportType === "byHouse") {
        drawTable(
          ["House", "Name", "Total"],
          summary.houseRows.map((row) => [
            row.houseCode,
            row.houseName || "--",
            currency(row.total),
          ])
        );
      }
      if (reportType === "summary") {
        drawTable(
          ["Category", "Total"],
          summary.expenseCategoryRows.map((row) => [
            row.category,
            currency(row.total),
          ])
        );
        drawTable(
          ["Tenant", "House", "Balance"],
          summary.arrearsRows.map((row) => [
            row.tenantName,
            row.houseLabel,
            currency(row.balance),
          ])
        );
      }
      if (reportType === "tenantDetail" && summary.selectedTenant) {
        drawTable(
          ["Tenant", "Move-in", "Period End"],
          [[
            summary.selectedTenant.fullName,
            summary.selectedTenant.moveInDate?.slice(0, 10) ?? "--",
            summary.tenantDetailRangeEndKey || "--",
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

      {reportType !== "tenantDetail" && (
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
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-sm font-semibold text-slate-100">
              Arrears by Tenant (Range)
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">House</th>
                    <th className="px-4 py-3">Expected</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.arrearsRows.map((row) => (
                    <tr
                      key={row.tenantId}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-400">{row.houseLabel}</td>
                      <td className="amount px-4 py-3">{currency(row.expected)}</td>
                      <td className="amount px-4 py-3">{currency(row.paid)}</td>
                      <td className="amount px-4 py-3 text-rose-200">{currency(row.balance)}</td>
                    </tr>
                  ))}
                  {summary.arrearsRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={5}>
                        No arrears in range.
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
            <div className="text-sm font-semibold text-slate-100">
              Expenses by Category (Range)
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm text-slate-300">
                <thead
                  className="text-xs text-slate-500"
                  style={{ backgroundColor: "var(--surface-strong)" }}
                >
                  <tr>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.expenseCategoryRows.map((row) => (
                    <tr
                      key={row.category}
                      className="border-t odd:bg-slate-950/30"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 text-slate-100">{row.category}</td>
                      <td className="amount px-4 py-3">{currency(row.total)}</td>
                    </tr>
                  ))}
                  {summary.expenseCategoryRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={2}>
                        No expenses in range.
                      </td>
                    </tr>
                  )}
                </tbody>
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
          <div className="text-sm font-semibold text-slate-100">Collections by House</div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
            <table className="w-full text-left text-sm text-slate-300">
              <thead
                className="text-xs text-slate-500"
                style={{ backgroundColor: "var(--surface-strong)" }}
              >
                <tr>
                  <th className="px-4 py-3">House</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Total Collected</th>
                </tr>
              </thead>
              <tbody>
                {summary.houseRows.map((row) => (
                  <tr
                    key={row.houseId}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-3 text-slate-100">{row.houseCode}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.houseName || "--"}
                    </td>
                    <td className="amount px-4 py-3">{currency(row.total)}</td>
                  </tr>
                ))}
                {summary.houseRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={3}>
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
                    Totals
                  </div>
                  <div className="amount mt-2 text-slate-100">
                    Paid {currency(summary.tenantDetailTotals.paid)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Period {summary.tenantDetailRangeStartKey} to{" "}
                    {summary.tenantDetailRangeEndKey}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Arrears{" "}
                    {currency(summary.tenantDetailTotals.balance)}
                  </div>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800">
                <table className="w-full text-left text-sm text-slate-300">
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
