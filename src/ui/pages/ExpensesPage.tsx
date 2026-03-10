import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import ExpenseForm from "../expenses/ExpenseForm";
import ExpenseList from "../expenses/ExpenseList";
import Modal from "../Modal";
import TypeaheadSearch from "../TypeaheadSearch";
import {
  createWorkspaceDocument,
  deleteScopedDocument,
  listAllDocuments,
  rcmsDatabaseId,
  rcmsReceiptsBucketId,
  storage,
  updateScopedDocument,
} from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type {
  Expense,
  ExpenseForm as ExpenseFormValues,
  House,
  SecurityDepositDeduction,
  Tenant,
} from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { getTenantEffectiveEndDate } from "../../lib/tenancyDates";

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

function resolveTenantHouseId(tenant: Tenant) {
  if (typeof tenant.house === "string") return tenant.house;
  return tenant.house?.$id ?? "";
}

function parseDateSafe(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function ExpensesPage() {
  const { user, permissions } = useAuth();
  const canRecordExpenses = permissions.canRecordExpenses;
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseSearchQuery, setExpenseSearchQuery] = useState("");

  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((a, b) => (b.expenseDate ?? "").localeCompare(a.expenseDate ?? "")),
    [expenses]
  );
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const filteredExpenses = useMemo(() => {
    const query = expenseSearchQuery.trim().toLowerCase();
    if (!query) return sortedExpenses;
    return sortedExpenses.filter((expense) => {
      const houseId = resolveExpenseHouseId(expense);
      const houseCode = houseLookup.get(houseId)?.code?.toLowerCase() ?? "";
      const category = expense.category?.toLowerCase() ?? "";
      const description = expense.description?.toLowerCase() ?? "";
      const source = expense.source?.toLowerCase() ?? "";
      const date = expense.expenseDate?.slice(0, 10) ?? "";
      const amount = String(expense.amount ?? "");
      return (
        category.includes(query) ||
        description.includes(query) ||
        source.includes(query) ||
        houseCode.includes(query) ||
        date.includes(query) ||
        amount.includes(query)
      );
    });
  }, [expenseSearchQuery, houseLookup, sortedExpenses]);
  const expenseSearchSuggestions = useMemo(() => {
    const values = new Set<string>();
    sortedExpenses.forEach((expense) => {
      if (expense.description?.trim()) values.add(expense.description.trim());
      values.add(expense.category);
      values.add(expense.source === "rent_cash" ? "rent cash" : "external");
      if (expense.expenseDate) values.add(expense.expenseDate.slice(0, 10));
      const houseId = resolveExpenseHouseId(expense);
      const houseCode = houseLookup.get(houseId)?.code;
      if (houseCode?.trim()) values.add(houseCode.trim());
    });
    return Array.from(values);
  }, [houseLookup, sortedExpenses]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [expenseResult, houseResult, tenantResult] = await Promise.all([
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
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [Query.orderAsc("fullName")],
        }),
      ]);
      setExpenses(expenseResult);
      setHouses(houseResult);
      setTenants(tenantResult);
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
    const {
      receiptFile: _ignoredReceiptFile,
      removeReceipt: _ignoredRemoveReceipt,
      ...baseValues
    } = values;
    return {
      ...baseValues,
      house: values.category === "maintenance" ? values.house || null : null,
      maintenanceType:
        values.category === "maintenance" ? values.maintenanceType || null : null,
      affectsSecurityDeposit:
        values.category === "maintenance" ? Boolean(values.affectsSecurityDeposit) : false,
      securityDepositDeductionNote:
        values.category === "maintenance" && values.affectsSecurityDeposit
          ? values.securityDepositDeductionNote?.trim() || null
          : null,
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

  const findOccupyingTenant = (houseId: string, expenseDate: string) => {
    const expenseDateValue = parseDateSafe(expenseDate);
    if (!expenseDateValue) return null;
    return (
      tenants.find((tenant) => {
        const tenantHouseId = resolveTenantHouseId(tenant);
        if (tenantHouseId !== houseId) return false;
        const moveInDate = parseDateSafe(tenant.moveInDate);
        if (!moveInDate || moveInDate.getTime() > expenseDateValue.getTime()) return false;
        const effectiveEndDate = getTenantEffectiveEndDate(tenant, expenseDateValue);
        return effectiveEndDate.getTime() >= expenseDateValue.getTime();
      }) ?? null
    );
  };

  const syncSecurityDepositDeductionForExpense = async (expense: Expense) => {
    const existing = await listAllDocuments<SecurityDepositDeduction>({
      databaseId: rcmsDatabaseId,
      collectionId: COLLECTIONS.securityDepositDeductions,
      queries: [Query.equal("expenseId", [expense.$id]), Query.limit(10)],
    });
    const existingRecord = existing[0] ?? null;

    const shouldLinkDeduction =
      expense.category === "maintenance" && Boolean(expense.affectsSecurityDeposit);
    if (!shouldLinkDeduction) {
      await Promise.all(
        existing.map((record) =>
          deleteScopedDocument({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.securityDepositDeductions,
            documentId: record.$id,
          })
        )
      );
      return;
    }

    const houseId = resolveExpenseHouseId(expense);
    if (!houseId) {
      throw new Error("Maintenance expense is missing house assignment.");
    }
    const occupyingTenant = findOccupyingTenant(houseId, expense.expenseDate);
    if (!occupyingTenant) {
      await Promise.all(
        existing.map((record) =>
          deleteScopedDocument({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.securityDepositDeductions,
            documentId: record.$id,
          })
        )
      );
      throw new Error(
        "No occupying tenant found on the expense date. Deposit deduction ledger was not updated."
      );
    }

    const deductionPayload = {
      tenantId: occupyingTenant.$id,
      expenseId: expense.$id,
      houseId,
      deductionDate: expense.expenseDate,
      itemFixed: expense.description?.trim() || expense.maintenanceType?.trim() || "Maintenance",
      amount: Number(expense.amount) || 0,
      deductionNote:
        expense.securityDepositDeductionNote?.trim() || expense.notes?.trim() || null,
      expenseReference: expense.$id,
    };

    if (existingRecord) {
      await updateScopedDocument<typeof deductionPayload>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.securityDepositDeductions,
        documentId: existingRecord.$id,
        data: deductionPayload,
      });
      if (existing.length > 1) {
        await Promise.all(
          existing.slice(1).map((record) =>
            deleteScopedDocument({
              databaseId: rcmsDatabaseId,
              collectionId: COLLECTIONS.securityDepositDeductions,
              documentId: record.$id,
            })
          )
        );
      }
      return;
    }

    await createWorkspaceDocument({
      databaseId: rcmsDatabaseId,
      collectionId: COLLECTIONS.securityDepositDeductions,
      documentId: ID.unique(),
      data: deductionPayload,
    });
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
      const previousReceiptFileId = editingExpense?.receiptFileId?.trim() || "";
      const previousReceiptBucketId =
        editingExpense?.receiptBucketId?.trim() || rcmsReceiptsBucketId;
      const shouldRemoveCurrentReceipt = Boolean(
        editingExpense && !uploadedReceipt && values.removeReceipt && previousReceiptFileId
      );
      const shouldDeletePreviousReceipt = Boolean(
        editingExpense &&
          previousReceiptFileId &&
          (uploadedReceipt || shouldRemoveCurrentReceipt)
      );

      if (uploadedReceipt) {
        payload.receiptFileId = uploadedReceipt.fileId;
        payload.receiptBucketId = uploadedReceipt.bucketId;
        payload.receiptFileName = uploadedReceipt.fileName;
        payload.receiptFileMimeType = uploadedReceipt.mimeType;
        payload.receiptFileSize = uploadedReceipt.fileSize;
      } else if (shouldRemoveCurrentReceipt) {
        payload.receiptFileId = null;
        payload.receiptBucketId = null;
        payload.receiptFileName = null;
        payload.receiptFileMimeType = null;
        payload.receiptFileSize = null;
      }

      let savedExpense: Expense | null = null;
      if (editingExpense) {
        const receiptAction: "unchanged" | "replaced" | "removed" = uploadedReceipt
          ? "replaced"
          : shouldRemoveCurrentReceipt
            ? "removed"
            : "unchanged";
        const updated = await updateScopedDocument<typeof payload, Expense>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.expenses,
          documentId: editingExpense.$id,
          data: payload,
        });
        savedExpense = updated as unknown as Expense;
        setExpenses((prev) =>
          prev.map((expense) =>
            expense.$id === editingExpense.$id ? (savedExpense as Expense) : expense
          )
        );
        toast.push("success", "Expense updated.");
        if (user) {
          void logAudit({
            entityType: "expense",
            entityId: editingExpense.$id,
            action: "update",
            actorId: user.id,
            details: {
              ...payload,
              receiptAction,
              receiptFileId: uploadedReceipt?.fileId ?? null,
            },
          });
        }
        if (shouldDeletePreviousReceipt && previousReceiptFileId) {
          try {
            await storage.deleteFile(previousReceiptBucketId, previousReceiptFileId);
          } catch (cleanupError) {
            console.error("Failed to clean up old expense receipt:", cleanupError);
          }
        }
      } else {
        const created = await createWorkspaceDocument({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.expenses,
          documentId: ID.unique(),
          data: payload,
        });
        savedExpense = created as unknown as Expense;
        setExpenses((prev) => [savedExpense as Expense, ...prev]);
        toast.push("success", "Expense recorded.");
        if (user) {
          void logAudit({
            entityType: "expense",
            entityId: (savedExpense as Expense).$id,
            action: "create",
            actorId: user.id,
            details: payload,
          });
        }
      }
      if (savedExpense) {
        try {
          await syncSecurityDepositDeductionForExpense(savedExpense);
        } catch (deductionError) {
          const message =
            deductionError instanceof Error
              ? deductionError.message
              : "Failed to sync security deposit deduction ledger.";
          toast.push("warning", message);
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
                {loading
                  ? "Loading..."
                  : `${filteredExpenses.length} of ${expenses.length} expenses`}
              </div>
            </div>
            <button
              onClick={loadData}
              className="btn-secondary text-sm"
            >
              Refresh
            </button>
          </div>
          <TypeaheadSearch
            label="Find Expense"
            placeholder="Search by description, category, house, date, or source"
            query={expenseSearchQuery}
            suggestions={expenseSearchSuggestions}
            onQueryChange={setExpenseSearchQuery}
          />

          <ExpenseList
            expenses={filteredExpenses}
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
                  affectsSecurityDeposit: Boolean(editingExpense.affectsSecurityDeposit),
                  securityDepositDeductionNote:
                    editingExpense.securityDepositDeductionNote ?? "",
                  notes: editingExpense.notes ?? "",
                }
              : null
          }
          currentReceipt={
            editingExpense?.receiptFileId
              ? {
                  url: storage.getFileView(
                    editingExpense.receiptBucketId?.trim() || rcmsReceiptsBucketId,
                    editingExpense.receiptFileId
                  ),
                  name: editingExpense.receiptFileName?.trim() || "View receipt",
                  size: editingExpense.receiptFileSize,
                }
              : null
          }
          submitLabel={editingExpense ? "Save Changes" : "Record Expense"}
        />
      </Modal>
    </section>
  );
}
