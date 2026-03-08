import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import ExpenseForm from "../expenses/ExpenseForm";
import ExpenseList from "../expenses/ExpenseList";
import Modal from "../Modal";
import {
  databases,
  listAllDocuments,
  rcmsDatabaseId,
  rcmsReceiptsBucketId,
  storage,
} from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type { Expense, ExpenseForm as ExpenseFormValues, House } from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";

type UploadedReceipt = {
  fileId: string;
  bucketId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

function resolveExpenseHouseId(expense: Expense) {
  if (typeof expense.house === "string") return expense.house;
  return expense.house?.$id ?? "";
}

export default function ExpensesPage() {
  const { user, permissions } = useAuth();
  const canRecordExpenses = permissions.canRecordExpenses;
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

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
        listAllDocuments<Expense>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.expenses,
          queries: [Query.orderDesc("expenseDate")],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [Query.orderAsc("code")],
        }),
      ]);
      setExpenses(expenseResult);
      setHouses(houseResult);
    } catch (err) {
      setError("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const normalizePayload = (values: ExpenseFormValues) => {
    const { receiptFile: _ignoredReceiptFile, ...baseValues } = values;
    return {
      ...baseValues,
      house: values.category === "maintenance" ? values.house || null : null,
      maintenanceType:
        values.category === "maintenance" ? values.maintenanceType || null : null,
      notes: values.notes?.trim() ? values.notes.trim() : null,
    };
  };

  const uploadReceipt = async (receipt: File): Promise<UploadedReceipt> => {
    const file = await storage.createFile(rcmsReceiptsBucketId, ID.unique(), receipt);
    return {
      fileId: file.$id,
      bucketId: rcmsReceiptsBucketId,
      fileName: file.name ?? receipt.name,
      mimeType: file.mimeType ?? receipt.type ?? "application/octet-stream",
      fileSize: Number(file.sizeOriginal ?? receipt.size ?? 0),
    };
  };

  const handleSave = async (values: ExpenseFormValues) => {
    if (!canRecordExpenses) {
      toast.push("warning", "You do not have permission to record expenses.");
      return;
    }
    setLoading(true);
    setError(null);
    let uploadedReceipt: UploadedReceipt | null = null;
    let saveSucceeded = false;
    try {
      const selectedReceipt = values.receiptFile?.item(0) ?? null;
      if (selectedReceipt) {
        if (selectedReceipt.size > 10 * 1024 * 1024) {
          throw new Error("Receipt file must be 10MB or smaller.");
        }
        uploadedReceipt = await uploadReceipt(selectedReceipt);
      }

      const payload: Record<string, unknown> = normalizePayload(values);
      if (uploadedReceipt) {
        payload.receiptFileId = uploadedReceipt.fileId;
        payload.receiptBucketId = uploadedReceipt.bucketId;
        payload.receiptFileName = uploadedReceipt.fileName;
        payload.receiptFileMimeType = uploadedReceipt.mimeType;
        payload.receiptFileSize = uploadedReceipt.fileSize;
      }

      if (editingExpense) {
        const previousReceiptFileId = editingExpense.receiptFileId?.trim() || "";
        const previousReceiptBucketId =
          editingExpense.receiptBucketId?.trim() || rcmsReceiptsBucketId;
        const updated = await databases.updateDocument(
          rcmsDatabaseId,
          COLLECTIONS.expenses,
          editingExpense.$id,
          payload
        );
        setExpenses((prev) =>
          prev.map((expense) =>
            expense.$id === editingExpense.$id ? (updated as unknown as Expense) : expense
          )
        );
        toast.push("success", "Expense updated.");
        if (user) {
          void logAudit({
            entityType: "expense",
            entityId: editingExpense.$id,
            action: "update",
            actorId: user.id,
            details: payload,
          });
        }
        if (
          uploadedReceipt &&
          previousReceiptFileId &&
          previousReceiptFileId !== uploadedReceipt.fileId
        ) {
          try {
            await storage.deleteFile(previousReceiptBucketId, previousReceiptFileId);
          } catch (cleanupError) {
            console.error("Failed to clean up old expense receipt:", cleanupError);
          }
        }
      } else {
        const created = await databases.createDocument(
          rcmsDatabaseId,
          COLLECTIONS.expenses,
          ID.unique(),
          payload
        );
        setExpenses((prev) => [created as unknown as Expense, ...prev]);
        toast.push("success", "Expense recorded.");
        if (user) {
          void logAudit({
            entityType: "expense",
            entityId: (created as unknown as Expense).$id,
            action: "create",
            actorId: user.id,
            details: payload,
          });
        }
      }
      saveSucceeded = true;
      setModalOpen(false);
      setEditingExpense(null);
      await loadData();
    } catch (err) {
      if (uploadedReceipt && !saveSucceeded) {
        try {
          await storage.deleteFile(uploadedReceipt.bucketId, uploadedReceipt.fileId);
        } catch (cleanupError) {
          console.error("Failed to clean up uploaded expense receipt:", cleanupError);
        }
      }
      const message = editingExpense
        ? "Failed to update expense."
        : err instanceof Error && err.message
          ? err.message
          : "Failed to record expense.";
      setError(message);
      toast.push("error", message);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingExpense(null);
    setModalOpen(true);
  };

  const openEditModal = (expense: Expense) => {
    if (!canRecordExpenses) {
      toast.push("warning", "You do not have permission to edit expenses.");
      return;
    }
    setEditingExpense(expense);
    setModalOpen(true);
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
        {canRecordExpenses && (
          <button
            onClick={openCreateModal}
            className="btn-primary text-sm"
          >
            Record Expense
          </button>
        )}
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

          <ExpenseList
            expenses={sortedExpenses}
            houses={houses}
            canEdit={canRecordExpenses}
            onEdit={openEditModal}
          />
        </div>
      </div>

      <Modal
        open={canRecordExpenses && modalOpen}
        title={editingExpense ? "Edit Expense" : "Record Expense"}
        description={
          editingExpense
            ? "Update this expense entry."
            : "Choose general or maintenance category."
        }
        onClose={() => {
          setModalOpen(false);
          setEditingExpense(null);
        }}
      >
        <ExpenseForm
          houses={houses}
          onSubmit={handleSave}
          disabled={loading}
          loading={loading}
          initialValues={
            editingExpense
              ? {
                  category: editingExpense.category,
                  description: editingExpense.description,
                  amount: editingExpense.amount,
                  source: editingExpense.source,
                  expenseDate: editingExpense.expenseDate?.slice(0, 10),
                  house: resolveExpenseHouseId(editingExpense),
                  maintenanceType: editingExpense.maintenanceType ?? "",
                  notes: editingExpense.notes ?? "",
                }
              : null
          }
          submitLabel={editingExpense ? "Save Changes" : "Record Expense"}
        />
      </Modal>
    </section>
  );
}
