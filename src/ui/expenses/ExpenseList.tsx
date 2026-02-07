import type { Expense, House } from "../../lib/schema";

type Props = {
  expenses: Expense[];
  houses: House[];
};

function resolveHouseLabel(expense: Expense, houses: House[]) {
  if (!expense.house) return "--";
  const match = houses.find((house) => house.$id === expense.house);
  return match ? match.code : "--";
}

export default function ExpenseList({ expenses, houses }: Props) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
          <tr>
            <th className="px-5 py-4">Category</th>
            <th className="px-5 py-4">Description</th>
            <th className="px-5 py-4">House</th>
            <th className="px-5 py-4">Amount</th>
            <th className="px-5 py-4">Date</th>
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
                {expense.expenseDate?.slice(0, 10)}
              </td>
            </tr>
          ))}
          {expenses.length === 0 && (
            <tr>
              <td className="px-5 py-6 text-slate-500" colSpan={5}>
                No expenses recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
