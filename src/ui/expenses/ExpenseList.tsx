import type { Expense, House } from "../../lib/schema";
import { formatDisplayDate } from "../../lib/dateDisplay";
import { rcmsReceiptsBucketId, storage } from "../../lib/appwrite";

type Props = {
  expenses: Expense[];
  houses: House[];
  canEdit?: boolean;
  onEdit?: (expense: Expense) => void;
};

function resolveHouseLabel(expense: Expense, houses: House[]) {
  if (!expense.house) return "--";
  const houseId =
    typeof expense.house === "string" ? expense.house : expense.house?.$id ?? "";
  const match = houses.find((house) => house.$id === houseId);
  return match ? match.code : "--";
}

function formatFileSize(bytes?: number) {
  const size = Number(bytes ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExpenseList({ expenses, houses, canEdit, onEdit }: Props) {
  const columnCount = canEdit ? 6 : 5;

  return (
    <div
      className="overflow-x-auto rounded-2xl border"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
          <tr>
            <th className="px-5 py-4">Category</th>
            <th className="px-5 py-4">Description</th>
            <th className="px-5 py-4">House</th>
            <th className="px-5 py-4">Amount</th>
            <th className="px-5 py-4">Date</th>
            {canEdit && <th className="px-5 py-4 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.$id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-5 py-4 text-slate-200">{expense.category}</td>
              <td className="px-5 py-4">
                <div className="font-semibold text-slate-100">
                  {expense.description}
                </div>
                <div className="text-xs text-slate-500">
                  {expense.source === "rent_cash" ? "Rent Cash" : "External"}
                </div>
                {expense.receiptFileId && (
                  <div className="mt-1 text-xs text-slate-400">
                    Receipt:{" "}
                    <a
                      href={storage.getFileView(
                        expense.receiptBucketId?.trim() || rcmsReceiptsBucketId,
                        expense.receiptFileId
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 underline"
                    >
                      {expense.receiptFileName?.trim() || "View receipt"}
                    </a>{" "}
                    <span className="text-slate-500">
                      ({formatFileSize(expense.receiptFileSize)})
                    </span>
                  </div>
                )}
              </td>
              <td className="px-5 py-4 text-slate-300">
                {resolveHouseLabel(expense, houses)}
              </td>
              <td className="amount px-5 py-4 text-slate-200">
                {expense.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </td>
              <td className="px-5 py-4 text-slate-400">
                {formatDisplayDate(expense.expenseDate)}
              </td>
              {canEdit && (
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit?.(expense)}
                    className="btn-secondary text-xs"
                  >
                    Edit
                  </button>
                </td>
              )}
            </tr>
          ))}
          {expenses.length === 0 && (
            <tr>
              <td className="px-5 py-6 text-slate-500" colSpan={columnCount}>
                No expenses recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
