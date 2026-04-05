import type { House } from "../../lib/schema";
import { getBaseRentForMonth } from "../../lib/rentHistory";
import { formatAmount } from "../../lib/numberFormat";

type Props = {
  houses: House[];
  selectedId?: string | null;
  onSelect: (house: House) => void;
  onEdit?: (house: House) => void;
  canManage: boolean;
};

export default function HouseList({
  houses,
  selectedId,
  onSelect,
  onEdit,
  canManage,
}: Props) {
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  return (
    <div
      className="overflow-x-auto rounded-2xl border"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <table className="min-w-full w-full text-left text-sm md:min-w-[620px]">
        <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
          <tr>
            <th className="px-3 py-3 sm:px-5 sm:py-4">House</th>
            <th className="px-3 py-3 sm:px-5 sm:py-4">Rent</th>
            <th className="px-3 py-3 sm:px-5 sm:py-4">Status</th>
            <th className="px-3 py-3 sm:px-5 sm:py-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {houses.map((house) => {
            const isActive = house.$id === selectedId;
            return (
              <tr
                key={house.$id}
                className={isActive ? "bg-blue-500/10" : "border-t"}
                style={!isActive ? { borderColor: "var(--border)" } : undefined}
              >
                <td className="px-3 py-3 sm:px-5 sm:py-4">
                  <div className="font-semibold text-slate-100">{house.code}</div>
                  <div className="text-xs text-slate-500">{house.name || "-"}</div>
                </td>
                <td className="amount px-3 py-3 text-slate-200 sm:px-5 sm:py-4">
                  {formatAmount(
                    getBaseRentForMonth({
                      monthKey: currentMonthKey,
                      houseHistoryJson: house.rentHistoryJson ?? null,
                      fallbackRent: house.monthlyRent ?? 0,
                    })
                  )}
                </td>
                <td className="px-3 py-3 sm:px-5 sm:py-4">
                  <span className="rounded-full border px-3 py-1 text-xs text-slate-300" style={{ borderColor: "var(--border)" }}>
                    {house.status}
                  </span>
                </td>
                <td className="px-3 py-3 sm:px-5 sm:py-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => onSelect(house)}
                      className="btn-secondary text-xs"
                    >
                      View
                    </button>
                    {canManage && onEdit && (
                      <button
                        onClick={() => onEdit(house)}
                        className="btn-secondary text-xs"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {houses.length === 0 && (
            <tr>
              <td className="px-3 py-6 text-slate-500 sm:px-5" colSpan={4}>
                No houses yet. Create the first house to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
