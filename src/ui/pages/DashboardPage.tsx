import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import { buildPaidByMonth } from "../payments/allocation";
import type {
  Expense,
  House,
  Payment,
  PaymentAllocation,
  Tenant,
} from "../../lib/schema";

type SummaryCard = {
  label: string;
  value: string;
  helper: string;
};

function currency(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

export default function DashboardPage() {
  const [houses, setHouses] = useState<House[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [houseResult, tenantResult, paymentResult, expenseResult] =
        await Promise.all([
          databases.listDocuments(rcmsDatabaseId, COLLECTIONS.houses, [
            Query.orderAsc("code"),
          ]),
          databases.listDocuments(rcmsDatabaseId, COLLECTIONS.tenants, [
            Query.orderAsc("fullName"),
          ]),
          databases.listDocuments(rcmsDatabaseId, COLLECTIONS.payments, [
            Query.orderDesc("paymentDate"),
          ]),
          databases.listDocuments(rcmsDatabaseId, COLLECTIONS.expenses, [
            Query.orderDesc("expenseDate"),
          ]),
        ]);
      setHouses(houseResult.documents as House[]);
      setTenants(tenantResult.documents as Tenant[]);
      setPayments(paymentResult.documents as Payment[]);
      setExpenses(expenseResult.documents as Expense[]);
    } catch (err) {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const summary = useMemo(() => {
    const today = new Date();
    const monthKey = format(today, "yyyy-MM");
    const houseLookup = new Map(houses.map((house) => [house.$id, house]));

    const occupied = houses.filter((house) => house.status === "occupied").length;
    const vacant = houses.filter((house) => house.status === "vacant").length;

    const expectedRent = tenants.reduce((total, tenant) => {
      if (tenant.status !== "active") return total;
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const rent = tenant.rentOverride ?? houseLookup.get(houseId)?.monthlyRent ?? 0;
      return total + rent;
    }, 0);

    const paidByMonth = buildPaidByMonth(payments);
    const paidThisMonth = paidByMonth[monthKey] ?? 0;
    const paidToDate = Object.values(paidByMonth).reduce((sum, value) => sum + value, 0);

    const monthsSinceMoveIn = tenants.map((tenant) => {
      const moveIn = new Date(tenant.moveInDate);
      const endDate = tenant.moveOutDate ? new Date(tenant.moveOutDate) : today;
      const start = startOfMonth(moveIn);
      const end = startOfMonth(endDate);
      const months =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth()) +
        1;
      return { tenant, months: Math.max(months, 0) };
    });

    const expectedToDate = monthsSinceMoveIn.reduce((total, item) => {
      if (item.tenant.status !== "active") return total;
      const houseId =
        typeof item.tenant.house === "string"
          ? item.tenant.house
          : item.tenant.house?.$id ?? "";
      const rent =
        item.tenant.rentOverride ?? houseLookup.get(houseId)?.monthlyRent ?? 0;
      return total + rent * item.months;
    }, 0);

    const arrears = Math.max(expectedToDate - paidToDate, 0);

    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const expensesThisMonth = expenses.filter((expense) => {
      const date = new Date(expense.expenseDate);
      return date >= monthStart && date <= monthEnd;
    });
    const generalExpenses = expensesThisMonth
      .filter((expense) => expense.category === "general")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const maintenanceExpenses = expensesThisMonth
      .filter((expense) => expense.category === "maintenance")
      .reduce((sum, expense) => sum + expense.amount, 0);

    const cards: SummaryCard[] = [
      {
        label: "Occupancy",
        value: `${occupied} occupied / ${vacant} vacant`,
        helper: `${houses.length} total houses`,
      },
      {
        label: "Rent Expected",
        value: currency(expectedRent),
        helper: "Current month expected",
      },
      {
        label: "Rent Collected",
        value: currency(paidThisMonth),
        helper: `Collected for ${monthKey}`,
      },
      {
        label: "Outstanding Arrears",
        value: currency(arrears),
        helper: "Total expected vs paid to date",
      },
      {
        label: "General Expenses",
        value: currency(generalExpenses),
        helper: `This month (${monthKey})`,
      },
      {
        label: "Maintenance Expenses",
        value: currency(maintenanceExpenses),
        helper: `This month (${monthKey})`,
      },
    ];

    return { cards, monthKey };
  }, [expenses, houses, payments, tenants]);

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
          Snapshot for {summary.monthKey}.
        </p>
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
