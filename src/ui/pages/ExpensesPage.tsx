import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import ExpenseForm from "../expenses/ExpenseForm";
import ExpenseList from "../expenses/ExpenseList";
import Modal from "../Modal";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type { Expense, ExpenseForm as ExpenseFormValues, House } from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";

export default function ExpensesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((a, b) => (b.expenseDate ?? "").localeCompare(a.expenseDate ?? "")),
    [expenses]
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [expenseResult, houseResult] = await Promise.all([
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.expenses, [
          Query.orderDesc("expenseDate"),
        ]),
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.houses, [
          Query.orderAsc("code"),
        ]),
      ]);
      setExpenses(expenseResult.documents as Expense[]);
      setHouses(houseResult.documents as House[]);
    } catch (err) {
      setError("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (values: ExpenseFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...values,
        house: values.category === "maintenance" ? values.house : null,
        maintenanceType:
          values.category === "maintenance" ? values.maintenanceType : null,
      };
      const created = await databases.createDocument(
        rcmsDatabaseId,
        COLLECTIONS.expenses,
        ID.unique(),
        payload
      );
      setExpenses((prev) => [created as Expense, ...prev]);
      toast.push("success", "Expense recorded.");
      setModalOpen(false);
      if (user) {
        void logAudit({
          entityType: "expense",
          entityId: (created as Expense).$id,
          action: "create",
          actorId: user.id,
          details: payload,
        });
      }
    } catch (err) {
      setError("Failed to record expense.");
      toast.push("error", "Failed to record expense.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
        <div className="text-sm text-slate-500">Expenses</div>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Expense Tracking
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Log general and maintenance expenses.
        </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary text-sm"
        >
          Record Expense
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">
                Expense Log
              </div>
              <div className="text-xs text-slate-500">
                {loading ? "Loading..." : `${expenses.length} expenses`}
              </div>
            </div>
            <button
              onClick={loadData}
              className="btn-secondary text-sm"
            >
              Refresh
            </button>
          </div>

          <ExpenseList expenses={sortedExpenses} houses={houses} />
        </div>
      </div>

      <Modal
        open={modalOpen}
        title="Record Expense"
        description="Choose general or maintenance category."
        onClose={() => setModalOpen(false)}
      >
        <ExpenseForm houses={houses} onSubmit={handleCreate} disabled={loading} loading={loading} />
      </Modal>
    </section>
  );
}
