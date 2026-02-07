import type { House } from "../../lib/schema";

type Props = {
  houses: House[];
  selectedId?: string | null;
  onSelect: (house: House) => void;
  onEdit: (house: House) => void;
  onDeactivate: (house: House) => void;
};

export default function HouseList({
  houses,
  selectedId,
  onSelect,
  onEdit,
  onDeactivate,
}: Props) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
          <tr>
            <th className="px-5 py-4">House</th>
            <th className="px-5 py-4">Rent</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4">Actions</th>
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
                <td className="px-5 py-4">
                  <div className="font-semibold text-slate-100">{house.code}</div>
                  <div className="text-xs text-slate-500">{house.name || "-"}</div>
                </td>
                <td className="amount px-5 py-4 text-slate-200">
                  {house.monthlyRent.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </td>
                <td className="px-5 py-4">
                  <span className="rounded-full border px-3 py-1 text-xs text-slate-300" style={{ borderColor: "var(--border)" }}>
                    {house.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onSelect(house)}
                      className="btn-secondary text-xs"
                    >
                      View
                    </button>
                    <button
                      onClick={() => onEdit(house)}
                      className="btn-secondary text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDeactivate(house)}
                      className="btn-danger text-xs"
                    >
                      Deactivate
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {houses.length === 0 && (
            <tr>
              <td className="px-5 py-6 text-slate-500" colSpan={4}>
                No houses yet. Create the first house to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
