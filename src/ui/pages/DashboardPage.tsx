import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { format } from "date-fns";
import { listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS, decodeJson } from "../../lib/schema";
import { buildMonthSeries, buildPaidByMonth } from "../payments/allocation";
import { buildRentByMonth } from "../../lib/rentHistory";
import type { Expense, House, Payment, PaymentAllocation, Tenant } from "../../lib/schema";

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

  const summary = useMemo(() => {
    const today = new Date();
    const monthKey = format(today, "yyyy-MM");
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
    const activeCurrentTenants = tenants.filter(
      (tenant) => tenant.status === "active" && !tenant.moveOutDate
    );
    const occupiedHouseIds = new Set(
      activeCurrentTenants
        .map((tenant) =>
          typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? ""
        )
        .filter(Boolean)
    );
    const inactiveHouses = houses.filter((house) => house.status === "inactive").length;
    const occupied = houses.filter((house) => occupiedHouseIds.has(house.$id)).length;
    const vacant = houses.filter(
      (house) => house.status !== "inactive" && !occupiedHouseIds.has(house.$id)
    ).length;

    const expectedRent = activeCurrentTenants.reduce((total, tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const rent = tenant.rentOverride ?? houseLookup.get(houseId)?.monthlyRent ?? 0;
      return total + rent;
    }, 0);

    const paidThisMonth = normalizedPayments.reduce((sum, payment) => {
      const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
      const sign = payment.isReversal ? -1 : 1;
      if (!allocation) {
        return payment.paymentDate?.slice(0, 7) === monthKey
          ? sum + Number(payment.amount)
          : sum;
      }
      return sum + (Number(allocation[monthKey] ?? 0) * sign);
    }, 0);

    const arrears = activeCurrentTenants.reduce((sum, tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const house = houseLookup.get(houseId);
      const tenantPayments = payments.filter((payment) => {
        const tenantId =
          typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";
        return tenantId === tenant.$id;
      });
      const months = buildMonthSeries(tenant.moveInDate, today);
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const rentByMonth = buildRentByMonth({
        months,
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
      });
      const expected = months.reduce((acc, month) => acc + (rentByMonth[month] ?? 0), 0);
      const paid = months.reduce((acc, month) => acc + (paidByMonth[month] ?? 0), 0);
      return sum + Math.max(expected - paid, 0);
    }, 0);

    const expensesThisMonth = expenses.filter(
      (expense) => expense.expenseDate?.slice(0, 7) === monthKey
    );
    const totalExpenses = expensesThisMonth.reduce(
      (sum, expense) => sum + expense.amount,
      0
    );
    const monthExpenseCount = expensesThisMonth.length;
    const monthPaymentCount = normalizedPayments.filter((payment) => {
      const allocation = decodeJson<PaymentAllocation>(payment.allocationJson);
      if (allocation) {
        return Number(allocation[monthKey] ?? 0) !== 0;
      }
      return payment.paymentDate?.slice(0, 7) === monthKey;
    }).length;

    const cards: SummaryCard[] = [
      {
        label: "Occupancy",
        value: `${occupied} occupied / ${vacant} vacant`,
        helper: `${houses.length} total houses (${inactiveHouses} inactive)`,
      },
      {
        label: "Rent Expected",
        value: currency(expectedRent),
        helper: "Current month expected",
      },
      {
        label: "Rent Collected",
        value: currency(paidThisMonth),
        helper: `Collected for ${monthKey} (${monthPaymentCount} payment records)`,
      },
      {
        label: "Outstanding Arrears",
        value: currency(arrears),
        helper: "Total expected vs paid to date",
      },
      {
        label: "Total Expenses",
        value: currency(totalExpenses),
        helper: `This month (${monthKey}) - ${monthExpenseCount} expense records`,
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
